#pragma once

#include "module_optimizer.h"

namespace ModuleOptimizerGpuShared {

using DenseSlotArray = std::array<int, Constants::CUDA_ATTR_DIM>;

struct DenseModuleData {
    DenseSlotArray slot_values = {};
    int total_attr_value = 0;
};

std::vector<int> BuildSlotValuePower(
    const std::unordered_set<int>& target_attributes,
    const std::unordered_set<int>& exclude_attributes);

std::vector<int> BuildMinAttrRequirementsDense(
    const std::unordered_map<int, int>& min_attr_sum_requirements);

std::vector<DenseModuleData> BuildDenseModuleData(
    const std::vector<ModuleInfo>& modules);

std::vector<int> BuildDenseModuleMatrix(
    const std::vector<DenseModuleData>& dense_modules);

std::vector<ModuleSolution> BuildGpuSolutions(
    const std::vector<ModuleInfo>& modules,
    int gpu_result_count,
    const std::vector<int>& gpu_scores,
    const std::vector<long long>& gpu_indices,
    int combination_size);

}  // namespace ModuleOptimizerGpuShared
