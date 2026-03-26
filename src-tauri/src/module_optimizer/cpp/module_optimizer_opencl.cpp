#include "module_optimizer.h"
#include "module_optimizer_gpu_shared.h"

#ifdef USE_OPENCL
#define CL_HPP_TARGET_OPENCL_VERSION 300
#define CL_HPP_MINIMUM_OPENCL_VERSION 200
#define CL_HPP_ENABLE_EXCEPTIONS
#include <CL/opencl.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <optional>
#include <queue>
#include <string>
#include <vector>

namespace {
using ModuleOptimizerGpuShared::BuildDenseModuleData;
using ModuleOptimizerGpuShared::BuildDenseModuleMatrix;
using ModuleOptimizerGpuShared::BuildGpuSolutions;
using ModuleOptimizerGpuShared::BuildMinAttrRequirementsDense;
using ModuleOptimizerGpuShared::BuildSlotValuePower;

constexpr size_t kRadixBins = 256;
constexpr size_t kBlockSize = 384;
constexpr size_t kEstimatedMaxBlocksPerComputeUnit = 16;
constexpr unsigned long long kMinBatchSize = 100000ULL;
constexpr unsigned long long kMaxBatchSize = 50000000ULL;

struct GpuConfigOpenCL {
    size_t max_work_group_size;
    cl_uint compute_units;
    cl_ulong global_memory;
    size_t optimal_local_size;
    size_t optimal_grid_size;
    size_t optimal_global_size;
    unsigned long long max_concurrent_threads;
    unsigned long long optimal_batch_size;
};

struct MinScoreFirst {
    bool operator()(const std::pair<int, unsigned long long>& lhs,
                    const std::pair<int, unsigned long long>& rhs) const {
        return lhs.first > rhs.first;
    }
};

static std::optional<cl::Device> SelectBestGpu() {
    std::vector<cl::Platform> platforms;
    cl::Platform::get(&platforms);

    cl::Device best_device;
    unsigned long long best_flops_score = 0ULL;
    cl_ulong best_global_memory = 0;
    bool found = false;

    for (const auto& platform : platforms) {
        std::vector<cl::Device> devices;
        try {
            platform.getDevices(CL_DEVICE_TYPE_GPU, &devices);
        } catch (const cl::Error& err) {
            if (err.err() == CL_DEVICE_NOT_FOUND) {
                continue;
            }
            throw;
        }

        for (const auto& device : devices) {
            cl_uint compute_units = 0;
            cl_uint clock_frequency = 0;
            cl_ulong global_memory = 0;
            device.getInfo(CL_DEVICE_MAX_COMPUTE_UNITS, &compute_units);
            device.getInfo(CL_DEVICE_MAX_CLOCK_FREQUENCY, &clock_frequency);
            device.getInfo(CL_DEVICE_GLOBAL_MEM_SIZE, &global_memory);

            const unsigned long long flops_score =
                static_cast<unsigned long long>(compute_units) *
                static_cast<unsigned long long>(clock_frequency);
            if (!found || flops_score > best_flops_score ||
                (flops_score == best_flops_score &&
                 global_memory > best_global_memory)) {
                best_device = device;
                best_flops_score = flops_score;
                best_global_memory = global_memory;
                found = true;
            }
        }
    }

    if (!found) {
        return std::nullopt;
    }
    return best_device;
}

static GpuConfigOpenCL GetGpuConfigOpenCL(const cl::Device& device) {
    GpuConfigOpenCL config{};
    device.getInfo(CL_DEVICE_MAX_WORK_GROUP_SIZE, &config.max_work_group_size);
    device.getInfo(CL_DEVICE_MAX_COMPUTE_UNITS, &config.compute_units);
    device.getInfo(CL_DEVICE_GLOBAL_MEM_SIZE, &config.global_memory);
    return config;
}

static void CalculateOptimalParamsOpenCL(
    GpuConfigOpenCL& config,
    unsigned long long total_combinations,
    size_t validated_local_size) {
    config.optimal_local_size =
        std::max<size_t>(1, std::min(validated_local_size, config.max_work_group_size));

    config.optimal_grid_size =
        static_cast<size_t>(config.compute_units) *
        kEstimatedMaxBlocksPerComputeUnit * 2U;
    config.max_concurrent_threads =
        static_cast<unsigned long long>(config.optimal_grid_size) *
        static_cast<unsigned long long>(config.optimal_local_size);

    if (total_combinations < config.max_concurrent_threads) {
        config.optimal_grid_size =
            static_cast<size_t>(
                (total_combinations + config.optimal_local_size - 1ULL) /
                config.optimal_local_size);
        config.max_concurrent_threads =
            static_cast<unsigned long long>(config.optimal_grid_size) *
            static_cast<unsigned long long>(config.optimal_local_size);
    }
    config.optimal_global_size =
        config.optimal_grid_size * config.optimal_local_size;

    const size_t available_memory =
        static_cast<size_t>(config.global_memory * 0.5);
    const unsigned long long memory_limited_batch =
        available_memory / (sizeof(int) + sizeof(unsigned long long));
    const unsigned long long compute_limited_batch =
        config.max_concurrent_threads * 3000ULL;

    config.optimal_batch_size =
        std::min(memory_limited_batch, compute_limited_batch);
    if (config.optimal_batch_size < kMinBatchSize) {
        config.optimal_batch_size = kMinBatchSize;
    }
    if (config.optimal_batch_size > kMaxBatchSize) {
        config.optimal_batch_size = kMaxBatchSize;
    }
}

static void PrintGpuConfigOpenCL(const GpuConfigOpenCL& config) {
    std::printf("OpenCL GPU Configuration:\n");
    std::printf("  Compute Units: %u\n", config.compute_units);
    std::printf("  Max Work Group Size: %zu\n", config.max_work_group_size);
    std::printf(
        "  Global Memory: %.1f MB\n",
        static_cast<double>(config.global_memory) / (1024 * 1024));
    std::printf("Optimal Parameters:\n");
    std::printf("  Local Size: %zu\n", config.optimal_local_size);
    std::printf("  Grid Size: %zu\n", config.optimal_grid_size);
    std::printf("  Global Size: %zu\n", config.optimal_global_size);
    std::printf("  Batch Size: %llu\n", config.optimal_batch_size);
}

static size_t ResolveKernelLocalSize(
    const cl::Device& device,
    const cl::Kernel& score_kernel,
    const cl::Kernel& histogram_kernel,
    const cl::Kernel& flag_kernel,
    const cl::Kernel& compact_kernel,
    size_t preferred_local_size) {
    size_t resolved_local_size = preferred_local_size;
    resolved_local_size = std::min(
        resolved_local_size,
        score_kernel.getWorkGroupInfo<CL_KERNEL_WORK_GROUP_SIZE>(device));
    resolved_local_size = std::min(
        resolved_local_size,
        histogram_kernel.getWorkGroupInfo<CL_KERNEL_WORK_GROUP_SIZE>(device));
    resolved_local_size = std::min(
        resolved_local_size,
        flag_kernel.getWorkGroupInfo<CL_KERNEL_WORK_GROUP_SIZE>(device));
    resolved_local_size = std::min(
        resolved_local_size,
        compact_kernel.getWorkGroupInfo<CL_KERNEL_WORK_GROUP_SIZE>(device));
    return std::max<size_t>(1, resolved_local_size);
}

static void BuildProgram(
    cl::Program& program,
    const cl::Device& device,
    const char* options) {
    try {
        program.build(std::vector<cl::Device>{device}, options);
    } catch (const cl::Error&) {
        const auto build_log = program.getBuildInfo<CL_PROGRAM_BUILD_LOG>(device);
        if (!build_log.empty()) {
            std::printf("%s\n", build_log.c_str());
        }
        throw;
    }
}

static void EnqueueKernel(
    cl::CommandQueue& queue,
    const cl::Kernel& kernel,
    size_t global_size,
    size_t local_size,
    cl::Event* event = nullptr) {
    queue.enqueueNDRangeKernel(
        kernel,
        cl::NullRange,
        cl::NDRange(global_size),
        cl::NDRange(local_size),
        nullptr,
        event);
}

static const char* kOpenClKernelSource = R"CLC(
#define OPENCL_ATTR_DIM 24
#define OPENCL_ATTR_CHUNKS 6
#define RADIX_BINS 256

ulong comb_count(ulong n, ulong r) {
    if (r > n) return 0UL;
    if (r == 0UL || r == n) return 1UL;
    if (r > n - r) r = n - r;
    ulong result = 1UL;
    for (ulong i = 0; i < r; ++i) {
        result = (result * (n - i)) / (i + 1UL);
    }
    return result;
}

void get_combination_by_index(uint n, uint r, ulong index, uint comb_out[5]) {
    ulong remaining = index;
    for (uint i = 0; i < r; ++i) {
        const uint start = (i == 0U) ? 0U : (comb_out[i - 1U] + 1U);
        const uint choose_count = r - i;
        const uint max_candidate = n - choose_count;
        const ulong base_prefix = comb_count((ulong)(n - start), (ulong)choose_count);

        uint lo = start;
        uint hi = max_candidate + 1U;
        while (lo + 1U < hi) {
            const uint mid = lo + ((hi - lo) >> 1);
            const ulong skipped_before_mid =
                base_prefix - comb_count((ulong)(n - mid), (ulong)choose_count);
            if (skipped_before_mid <= remaining) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        const ulong skipped_before_lo =
            base_prefix - comb_count((ulong)(n - lo), (ulong)choose_count);
        comb_out[i] = lo;
        remaining -= skipped_before_lo;
    }
}

int next_combination_level(uint n, uint r, uint comb[5]) {
    for (int pos = (int)r - 1; pos >= 0; --pos) {
        const uint limit = n - (r - (uint)pos);
        if (comb[pos] < limit) {
            ++comb[pos];
            for (uint k = (uint)pos + 1U; k < r; ++k) {
                comb[k] = comb[k - 1U] + 1U;
            }
            return ((int)r - 1) - pos;
        }
    }
    return -1;
}

inline int4 load_row_chunk(__global const int* module_matrix, uint row_idx, int chunk) {
    return vload4(chunk, module_matrix + (ulong)row_idx * OPENCL_ATTR_DIM);
}

void compute_prefix_sum3(
    __global const int* module_matrix,
    uint idx0,
    uint idx1,
    uint idx2,
    int4 sum_prefix[OPENCL_ATTR_CHUNKS]) {
    for (int chunk = 0; chunk < OPENCL_ATTR_CHUNKS; ++chunk) {
        sum_prefix[chunk] =
            load_row_chunk(module_matrix, idx0, chunk) +
            load_row_chunk(module_matrix, idx1, chunk) +
            load_row_chunk(module_matrix, idx2, chunk);
    }
}

void compute_prefix_sum4(
    __global const int* module_matrix,
    uint idx0,
    uint idx1,
    uint idx2,
    uint idx3,
    int4 sum_prefix[OPENCL_ATTR_CHUNKS]) {
    for (int chunk = 0; chunk < OPENCL_ATTR_CHUNKS; ++chunk) {
        sum_prefix[chunk] =
            load_row_chunk(module_matrix, idx0, chunk) +
            load_row_chunk(module_matrix, idx1, chunk) +
            load_row_chunk(module_matrix, idx2, chunk) +
            load_row_chunk(module_matrix, idx3, chunk);
    }
}

void score_range_impl(
    __global const int* module_matrix,
    int module_count,
    __constant const int* slot_value_power,
    __constant const int* min_attr_requirements,
    __constant const int* total_attr_power_values,
    ulong range_start,
    ulong range_len,
    __global int* out_scores,
    __global ulong* out_indices,
    uint combination_size) {
    const ulong gid = (ulong)get_global_id(0);
    const ulong total_threads = (ulong)get_global_size(0);
    if (range_len == 0UL) return;

    const ulong work_per_thread = (range_len + total_threads - 1UL) / total_threads;
    const ulong seg_start = range_start + gid * work_per_thread;
    const ulong range_end = range_start + range_len;
    if (seg_start >= range_end) return;

    ulong seg_end = seg_start + work_per_thread;
    if (seg_end > range_end) {
        seg_end = range_end;
    }
    const ulong active_threads =
        (range_len + work_per_thread - 1UL) / work_per_thread;
    const ulong last_segment_length =
        range_len - (active_threads - 1UL) * work_per_thread;

    uint comb[5] = {0U, 0U, 0U, 0U, 0U};
    get_combination_by_index((uint)module_count, combination_size, seg_start, comb);

    int4 sum_prefix[OPENCL_ATTR_CHUNKS];
    if (combination_size == 5U) {
        compute_prefix_sum4(
            module_matrix, comb[0], comb[1], comb[2], comb[3], sum_prefix);
    } else {
        compute_prefix_sum3(module_matrix, comb[0], comb[1], comb[2], sum_prefix);
    }

    ulong local_offset = 0UL;
    for (ulong combo_idx = seg_start; combo_idx < seg_end; ++combo_idx, ++local_offset) {
        ulong output_idx = 0UL;
        if (local_offset < last_segment_length) {
            output_idx = local_offset * active_threads + gid;
        } else {
            output_idx =
                last_segment_length * active_threads +
                (local_offset - last_segment_length) * (active_threads - 1UL) + gid;
        }

        int total_attr_value = 0;
        int threshold_power = 0;
        int valid_mask = 1;

        for (int chunk = 0; chunk < OPENCL_ATTR_CHUNKS; ++chunk) {
            const int4 prefix = sum_prefix[chunk];
            const int4 tail = load_row_chunk(module_matrix, comb[combination_size - 1U], chunk);
            const int4 values = prefix + tail;
            const int attr_idx = chunk * 4;

            int attr_value = values.x;
            total_attr_value += attr_value;
            valid_mask &= (attr_value >= min_attr_requirements[attr_idx]);
            threshold_power += slot_value_power[attr_idx * 21 + min(attr_value, 20)];

            attr_value = values.y;
            total_attr_value += attr_value;
            valid_mask &= (attr_value >= min_attr_requirements[attr_idx + 1]);
            threshold_power += slot_value_power[(attr_idx + 1) * 21 + min(attr_value, 20)];

            attr_value = values.z;
            total_attr_value += attr_value;
            valid_mask &= (attr_value >= min_attr_requirements[attr_idx + 2]);
            threshold_power += slot_value_power[(attr_idx + 2) * 21 + min(attr_value, 20)];

            attr_value = values.w;
            total_attr_value += attr_value;
            valid_mask &= (attr_value >= min_attr_requirements[attr_idx + 3]);
            threshold_power += slot_value_power[(attr_idx + 3) * 21 + min(attr_value, 20)];
        }

        const int total_attr_power = total_attr_power_values[min(total_attr_value, 120)];
        const int combat_power = threshold_power + total_attr_power;
        ulong packed = 0UL;
        for (uint i = 0; i < combination_size; ++i) {
            packed |= ((ulong)(comb[i] & 0x0FFFU) << (i * 12));
        }

        out_scores[output_idx] = combat_power * valid_mask;
        out_indices[output_idx] = packed * (ulong)valid_mask;

        const int combination_level =
            next_combination_level((uint)module_count, combination_size, comb);
        if (combination_level < 0) {
            break;
        }
        if (combination_level >= 1) {
            if (combination_size == 5U) {
                compute_prefix_sum4(
                    module_matrix, comb[0], comb[1], comb[2], comb[3], sum_prefix);
            } else {
                compute_prefix_sum3(
                    module_matrix, comb[0], comb[1], comb[2], sum_prefix);
            }
        }
    }
}

__kernel void score_range_dense4(
    __global const int* module_matrix,
    int module_count,
    __constant const int* slot_value_power,
    __constant const int* min_attr_requirements,
    __constant const int* total_attr_power_values,
    ulong range_start,
    ulong range_len,
    __global int* out_scores,
    __global ulong* out_indices) {
    score_range_impl(
        module_matrix,
        module_count,
        slot_value_power,
        min_attr_requirements,
        total_attr_power_values,
        range_start,
        range_len,
        out_scores,
        out_indices,
        4U);
}

__kernel void score_range_dense5(
    __global const int* module_matrix,
    int module_count,
    __constant const int* slot_value_power,
    __constant const int* min_attr_requirements,
    __constant const int* total_attr_power_values,
    ulong range_start,
    ulong range_len,
    __global int* out_scores,
    __global ulong* out_indices) {
    score_range_impl(
        module_matrix,
        module_count,
        slot_value_power,
        min_attr_requirements,
        total_attr_power_values,
        range_start,
        range_len,
        out_scores,
        out_indices,
        5U);
}

__kernel void histogram_byte_radix(
    __global const int* scores,
    ulong n,
    uint prefix_mask,
    uint prefix_value,
    int byte_idx,
    __global uint* g_hist,
    __local uint* s_hist) {
    const size_t lid = get_local_id(0);
    const size_t lsz = get_local_size(0);
    const size_t gid = get_global_id(0);
    const size_t gsz = get_global_size(0);

    for (uint i = (uint)lid; i < RADIX_BINS; i += (uint)lsz) {
        s_hist[i] = 0U;
    }
    barrier(CLK_LOCAL_MEM_FENCE);

    const int shift = byte_idx * 8;
    for (ulong idx = (ulong)gid; idx < n; idx += (ulong)gsz) {
        const uint score = (uint)scores[idx];
        if ((score & prefix_mask) == prefix_value) {
            const uint bucket = (score >> shift) & 0xFFU;
            atomic_inc((volatile __local uint*)&s_hist[bucket]);
        }
    }
    barrier(CLK_LOCAL_MEM_FENCE);

    for (uint i = (uint)lid; i < RADIX_BINS; i += (uint)lsz) {
        if (s_hist[i] > 0U) {
            atomic_add((volatile __global uint*)&g_hist[i], s_hist[i]);
        }
    }
}

__kernel void flag_scores_by_threshold(
    __global const int* scores,
    ulong n,
    int threshold,
    __global uchar* flags) {
    const size_t gid = get_global_id(0);
    const size_t gsz = get_global_size(0);
    for (ulong i = (ulong)gid; i < n; i += (ulong)gsz) {
        flags[i] = (uchar)((scores[i] >= threshold) ? 1 : 0);
    }
}

__kernel void compact_selected(
    __global const int* scores,
    __global const ulong* indices,
    __global const uchar* flags,
    ulong n,
    __global int* out_scores,
    __global ulong* out_indices,
    __global uint* out_count) {
    const size_t gid = get_global_id(0);
    const size_t gsz = get_global_size(0);
    for (ulong i = (ulong)gid; i < n; i += (ulong)gsz) {
        if (flags[i]) {
            const uint pos = atomic_inc((volatile __global uint*)out_count);
            out_scores[pos] = scores[i];
            out_indices[pos] = indices[i];
        }
    }
}
)CLC";

}  // namespace

extern "C" int TestOpenCL() {
    try {
        return SelectBestGpu().has_value() ? 1 : 0;
    } catch (const cl::Error&) {
        return 0;
    }
}

extern "C" int GpuStrategyEnumerationOpenCL(
    const int* module_matrix,
    int module_count,
    const int* slot_value_power,
    const int* min_attr_requirements,
    int max_solutions,
    int* result_scores,
    long long* result_indices,
    int combination_size,
    ProgressContext* progress) {
    if (module_count <= 0 || max_solutions <= 0 ||
        combination_size < 4 || combination_size > 5) {
        return 0;
    }

    try {
        const auto device_opt = SelectBestGpu();
        if (!device_opt.has_value()) {
            return 0;
        }

        const cl::Device device = *device_opt;
        const unsigned long long total_combinations =
            static_cast<unsigned long long>(
                CombinationCount(static_cast<size_t>(module_count),
                                 static_cast<size_t>(combination_size)));
        if (total_combinations == 0ULL) {
            return 0;
        }

        GpuConfigOpenCL gpu_config = GetGpuConfigOpenCL(device);
        cl::Context ctx(device);
        cl::CommandQueue queue(ctx, device);
        cl::Program program(ctx, std::string(kOpenClKernelSource));
        BuildProgram(
            program,
            device,
            "-cl-std=CL3.0 -cl-mad-enable -cl-fast-relaxed-math -cl-finite-math-only");
        cl::Kernel score_kernel(
            program,
            combination_size == 5 ? "score_range_dense5" : "score_range_dense4");
        cl::Kernel histogram_kernel(program, "histogram_byte_radix");
        cl::Kernel flag_kernel(program, "flag_scores_by_threshold");
        cl::Kernel compact_kernel(program, "compact_selected");
        const size_t preferred_local_size =
            std::min(kBlockSize, gpu_config.max_work_group_size);
        const size_t validated_local_size = ResolveKernelLocalSize(
            device,
            score_kernel,
            histogram_kernel,
            flag_kernel,
            compact_kernel,
            preferred_local_size);
        CalculateOptimalParamsOpenCL(
            gpu_config, total_combinations, validated_local_size);
        PrintGpuConfigOpenCL(gpu_config);

        cl::Buffer d_module_matrix(
            ctx,
            CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
            sizeof(int) * static_cast<size_t>(module_count) *
                static_cast<size_t>(Constants::CUDA_ATTR_DIM),
            const_cast<int*>(module_matrix));
        cl::Buffer d_slot_value_power(
            ctx,
            CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
            sizeof(int) * static_cast<size_t>(Constants::CUDA_ATTR_DIM) * 21U,
            const_cast<int*>(slot_value_power));
        cl::Buffer d_min_attr_requirements(
            ctx,
            CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
            sizeof(int) * static_cast<size_t>(Constants::CUDA_ATTR_DIM),
            const_cast<int*>(min_attr_requirements));
        cl::Buffer d_total_attr_power(
            ctx,
            CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
            sizeof(int) * Constants::TOTAL_ATTR_POWER_VALUES.size(),
            const_cast<int*>(Constants::TOTAL_ATTR_POWER_VALUES.data()));

        using TopKItem = std::pair<int, unsigned long long>;
        std::priority_queue<
            TopKItem,
            std::vector<TopKItem>,
            MinScoreFirst>
            topk;
        if (progress != nullptr) {
            progress->set_processed(0);
            progress->set_total(static_cast<std::uint64_t>(total_combinations));
        }

        const size_t max_batch =
            static_cast<size_t>(gpu_config.optimal_batch_size);
        cl::Buffer d_scores(ctx, CL_MEM_READ_WRITE, sizeof(int) * max_batch);
        cl::Buffer d_indices(
            ctx,
            CL_MEM_READ_WRITE,
            sizeof(unsigned long long) * max_batch);
        cl::Buffer d_hist(ctx, CL_MEM_READ_WRITE, sizeof(cl_uint) * kRadixBins);
        cl::Buffer d_flags(
            ctx,
            CL_MEM_READ_WRITE,
            sizeof(unsigned char) * max_batch);
        cl::Buffer d_selected_count(ctx, CL_MEM_READ_WRITE, sizeof(cl_uint));
        cl::Buffer d_comp_scores(ctx, CL_MEM_READ_WRITE, sizeof(int) * max_batch);
        cl::Buffer d_comp_indices(
            ctx,
            CL_MEM_READ_WRITE,
            sizeof(unsigned long long) * max_batch);

        std::vector<int> h_scores_sel(max_batch);
        std::vector<unsigned long long> h_indices_sel(max_batch);

        int score_arg = 0;
        score_kernel.setArg(score_arg++, d_module_matrix);
        score_kernel.setArg(score_arg++, module_count);
        score_kernel.setArg(score_arg++, d_slot_value_power);
        score_kernel.setArg(score_arg++, d_min_attr_requirements);
        score_kernel.setArg(score_arg++, d_total_attr_power);
        score_kernel.setArg(score_arg++, cl_ulong{0});
        score_kernel.setArg(score_arg++, cl_ulong{0});
        score_kernel.setArg(score_arg++, d_scores);
        score_kernel.setArg(score_arg++, d_indices);

        int hist_arg = 0;
        histogram_kernel.setArg(hist_arg++, d_scores);
        histogram_kernel.setArg(hist_arg++, cl_ulong{0});
        histogram_kernel.setArg(hist_arg++, cl_uint{0});
        histogram_kernel.setArg(hist_arg++, cl_uint{0});
        histogram_kernel.setArg(hist_arg++, 0);
        histogram_kernel.setArg(hist_arg++, d_hist);
        histogram_kernel.setArg(hist_arg++, cl::Local(sizeof(cl_uint) * kRadixBins));

        int flag_arg = 0;
        flag_kernel.setArg(flag_arg++, d_scores);
        flag_kernel.setArg(flag_arg++, cl_ulong{0});
        flag_kernel.setArg(flag_arg++, 0);
        flag_kernel.setArg(flag_arg++, d_flags);

        int compact_arg = 0;
        compact_kernel.setArg(compact_arg++, d_scores);
        compact_kernel.setArg(compact_arg++, d_indices);
        compact_kernel.setArg(compact_arg++, d_flags);
        compact_kernel.setArg(compact_arg++, cl_ulong{0});
        compact_kernel.setArg(compact_arg++, d_comp_scores);
        compact_kernel.setArg(compact_arg++, d_comp_indices);
        compact_kernel.setArg(compact_arg++, d_selected_count);

        unsigned long long processed = 0ULL;
        while (processed < total_combinations) {
            const unsigned long long batch = std::min(
                gpu_config.optimal_batch_size, total_combinations - processed);
            const size_t out_count = static_cast<size_t>(batch);
            const cl_ulong range_start = static_cast<cl_ulong>(processed);
            const cl_ulong range_len = static_cast<cl_ulong>(batch);
            const cl_ulong n64 = static_cast<cl_ulong>(out_count);

            score_kernel.setArg(5, range_start);
            score_kernel.setArg(6, range_len);

            const size_t local_size = gpu_config.optimal_local_size;
            size_t grid_size = gpu_config.optimal_grid_size;
            const size_t batch_grid_size =
                (out_count + local_size - 1) / local_size;
            if (grid_size > batch_grid_size) {
                grid_size = batch_grid_size;
            }
            const size_t global_size = grid_size * local_size;
            cl::Event score_done;
            EnqueueKernel(
                queue, score_kernel, global_size, local_size, &score_done);
            score_done.wait();

            int k_needed = std::min(max_solutions, static_cast<int>(batch));
            cl_uint prefix_mask = 0U;
            cl_uint prefix_value = 0U;
            for (int byte_idx = 3; byte_idx >= 0; --byte_idx) {
                const cl_uint zero_u = 0U;
                queue.enqueueFillBuffer(
                    d_hist, zero_u, 0, sizeof(cl_uint) * kRadixBins);

                histogram_kernel.setArg(1, n64);
                histogram_kernel.setArg(2, prefix_mask);
                histogram_kernel.setArg(3, prefix_value);
                histogram_kernel.setArg(4, byte_idx);
                EnqueueKernel(
                    queue,
                    histogram_kernel,
                    global_size,
                    local_size);

                cl_uint h_hist[kRadixBins];
                queue.enqueueReadBuffer(
                    d_hist, CL_TRUE, 0, sizeof(h_hist), h_hist);

                cl_uint acc = 0U;
                int chosen_bucket = 0;
                for (int bucket = static_cast<int>(kRadixBins) - 1; bucket >= 0; --bucket) {
                    acc += h_hist[bucket];
                    if (acc >= static_cast<cl_uint>(k_needed)) {
                        chosen_bucket = bucket;
                        break;
                    }
                }

                const cl_uint bigger_acc = acc - h_hist[chosen_bucket];
                k_needed -= static_cast<int>(bigger_acc);
                prefix_mask |= 0xFFU << (byte_idx * 8);
                prefix_value |=
                    static_cast<cl_uint>(chosen_bucket << (byte_idx * 8));
            }

            const int threshold_value = static_cast<int>(prefix_value);
            flag_kernel.setArg(1, n64);
            flag_kernel.setArg(2, threshold_value);
            EnqueueKernel(queue, flag_kernel, global_size, local_size);

            const cl_uint zero_u = 0U;
            queue.enqueueFillBuffer(d_selected_count, zero_u, 0, sizeof(cl_uint));
            compact_kernel.setArg(3, n64);
            EnqueueKernel(queue, compact_kernel, global_size, local_size);

            cl_uint selected_count = 0;
            queue.enqueueReadBuffer(
                d_selected_count,
                CL_TRUE,
                0,
                sizeof(selected_count),
                &selected_count);

            if (selected_count > 0U) {
                const size_t selected_size = static_cast<size_t>(selected_count);
                queue.enqueueReadBuffer(
                    d_comp_scores,
                    CL_TRUE,
                    0,
                    sizeof(int) * selected_size,
                    h_scores_sel.data());
                queue.enqueueReadBuffer(
                    d_comp_indices,
                    CL_TRUE,
                    0,
                    sizeof(unsigned long long) * selected_size,
                    h_indices_sel.data());
                for (size_t i = 0; i < selected_size; ++i) {
                    const TopKItem item{h_scores_sel[i], h_indices_sel[i]};
                    if (topk.size() < static_cast<size_t>(max_solutions)) {
                        topk.push(item);
                    } else if (item.first > topk.top().first) {
                        topk.pop();
                        topk.push(item);
                    }
                }
            }

            processed += batch;
            if (progress != nullptr) {
                progress->set_processed(static_cast<std::uint64_t>(processed));
            }
        }

        std::vector<TopKItem> items;
        items.reserve(topk.size());
        while (!topk.empty()) {
            items.push_back(topk.top());
            topk.pop();
        }
        std::sort(items.begin(), items.end(), [](const TopKItem& lhs, const TopKItem& rhs) {
            return lhs.first > rhs.first;
        });
        const int result_count = static_cast<int>(
            std::min(items.size(), static_cast<size_t>(max_solutions)));
        for (int i = 0; i < result_count; ++i) {
            result_scores[i] = items[static_cast<size_t>(i)].first;
            result_indices[i] =
                static_cast<long long>(items[static_cast<size_t>(i)].second);
        }

        return result_count;
    } catch (const cl::Error& err) {
        std::printf("OpenCL error: %s (%d)\n", err.what(), err.err());
        return 0;
    }
}

#endif

std::vector<ModuleSolution> ModuleOptimizerCpp::StrategyEnumerationOpenCL(
    const std::vector<ModuleInfo>& modules,
    const std::unordered_set<int>& target_attributes,
    const std::unordered_set<int>& exclude_attributes,
    const std::unordered_map<int, int>& min_attr_sum_requirements,
    int max_solutions,
    int max_workers,
    int combination_size,
    std::shared_ptr<ProgressContext> progress) {
#ifdef USE_OPENCL
    (void)max_workers;
    if (!TestOpenCL()) {
        printf("OpenCL not available, using CPU optimized version\n");
        return StrategyEnumeration(
            modules, target_attributes, exclude_attributes,
            min_attr_sum_requirements, max_solutions, max_workers, combination_size,
            progress);
    }

    printf("OpenCL GPU acceleration enabled - dense LUT kernel\n");

    const auto slot_value_power =
        BuildSlotValuePower(target_attributes, exclude_attributes);
    const auto dense_modules = BuildDenseModuleData(modules);
    const auto min_attr_requirements =
        BuildMinAttrRequirementsDense(min_attr_sum_requirements);
    const auto module_matrix = BuildDenseModuleMatrix(dense_modules);

    std::vector<int> gpu_scores(max_solutions);
    std::vector<long long> gpu_indices(max_solutions);
    const int gpu_result_count = GpuStrategyEnumerationOpenCL(
        module_matrix.data(),
        static_cast<int>(modules.size()),
        slot_value_power.data(),
        min_attr_requirements.data(),
        max_solutions,
        gpu_scores.data(),
        gpu_indices.data(),
        combination_size,
        progress ? progress.get() : nullptr);

    return BuildGpuSolutions(
        modules, gpu_result_count, gpu_scores, gpu_indices, combination_size);
#else
    (void)modules;
    (void)target_attributes;
    (void)exclude_attributes;
    (void)min_attr_sum_requirements;
    (void)max_solutions;
    (void)max_workers;
    (void)combination_size;
    (void)progress;
    return {};
#endif
}


