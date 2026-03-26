use rand::prelude::*;
use rand::rngs::StdRng;
use resonance_logs_lib::module_optimizer::{
    ModuleInfo, ModulePart, ModuleSolution, OptimizeOptions, check_gpu_support,
    strategy_beam_search_with_params, strategy_enumeration_cuda, strategy_enumeration_gpu,
    strategy_enumeration_opencl,
};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const DENSE_ATTR_TYPES: [i32; 21] = [
    1110, 1111, 1112, 1113, 1114, 1205, 1206, 1307, 1308, 1407, 1408, 1409, 1410, 2104, 2105, 2204,
    2205, 2304, 2404, 2405, 2406,
];
const TOP_K: usize = 100;
const BENCHMARK_INPUT_MODULES: i32 = 450;
const COMBINATION_SIZE_FIVE: i32 = 5;
const BENCHMARK_SEED: u64 = 42;
const BENCHMARK_MAX_WORKERS: i32 = 24;
const BENCHMARK_BEAM_WIDTH: i32 = 5096;
const BENCHMARK_EXPAND_PER_STATE: i32 = 0;
const CONSTRAINED_MIN_ATTR_REQUIREMENTS: [(i32, i32); 2] = [(1110, 4), (2104, 2)];

#[derive(Debug)]
struct TopKMetrics {
    best_score_equal: bool,
    best_score_gap: Option<i32>,
    topk_overlap_count: usize,
    topk_overlap_ratio: f64,
    topk_jaccard: f64,
    baseline_best_score: Option<i32>,
    candidate_best_score: Option<i32>,
}

fn generate_deterministic_modules(num_modules: i32, seed: u64) -> Vec<ModuleInfo> {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut modules = Vec::with_capacity(num_modules as usize);
    let module_types = [0, 1, 2, 3, 4, 5];

    for i in 0..num_modules {
        let config_id = *module_types
            .choose(&mut rng)
            .expect("module types available");
        let num_attrs = rng.random_range(2..=3);
        let mut parts = Vec::with_capacity(num_attrs as usize);

        for _ in 0..num_attrs {
            let attr_type = *DENSE_ATTR_TYPES
                .choose(&mut rng)
                .expect("dense attr types available");
            let value = rng.random_range(1..=10);
            parts.push(ModulePart {
                id: attr_type,
                name: format!("attr_{attr_type}"),
                value,
            });
        }

        modules.push(ModuleInfo {
            name: format!("test_module_{i}"),
            config_id,
            uuid: i,
            quality: rng.random_range(1..=5),
            parts,
        });
    }

    modules
}

fn gpu_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static GPU_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    GPU_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn benchmark<T>(func: impl FnOnce() -> T) -> (T, Duration) {
    let started = Instant::now();
    let result = func();
    (result, started.elapsed())
}

fn extract_scores(result: &[ModuleSolution]) -> Vec<i32> {
    result.iter().map(|solution| solution.score).collect()
}

fn extract_positive_scores(result: &[ModuleSolution]) -> Vec<i32> {
    result
        .iter()
        .filter_map(|solution| (solution.score > 0).then_some(solution.score))
        .collect()
}

fn normalize_scores(mut scores: Vec<i32>) -> Vec<i32> {
    scores.sort_unstable_by(|left, right| right.cmp(left));
    scores
}

fn build_score_counts(scores: &[i32]) -> HashMap<i32, usize> {
    let mut counts = HashMap::with_capacity(scores.len());
    for &score in scores {
        *counts.entry(score).or_insert(0) += 1;
    }
    counts
}

fn compare_topk(baseline_scores: &[i32], candidate_scores: &[i32], top_k: usize) -> TopKMetrics {
    let baseline_topk = &baseline_scores[..baseline_scores.len().min(top_k)];
    let candidate_topk = &candidate_scores[..candidate_scores.len().min(top_k)];

    let baseline_counts = build_score_counts(baseline_topk);
    let candidate_counts = build_score_counts(candidate_topk);
    let overlap_count: usize = baseline_counts
        .iter()
        .map(|(score, baseline_count)| {
            candidate_counts
                .get(score)
                .map_or(0, |candidate_count| (*baseline_count).min(*candidate_count))
        })
        .sum();
    let union_count: usize = baseline_counts
        .iter()
        .map(|(score, baseline_count)| {
            candidate_counts
                .get(score)
                .map_or(*baseline_count, |candidate_count| {
                    (*baseline_count).max(*candidate_count)
                })
        })
        .sum::<usize>()
        + candidate_counts
            .iter()
            .filter(|(score, _)| !baseline_counts.contains_key(*score))
            .map(|(_, count)| *count)
            .sum::<usize>();
    let denom = baseline_topk.len().min(candidate_topk.len()).max(1) as f64;

    let baseline_best = baseline_topk.first().copied();
    let candidate_best = candidate_topk.first().copied();

    TopKMetrics {
        best_score_equal: baseline_best == candidate_best,
        best_score_gap: baseline_best
            .zip(candidate_best)
            .map(|(left, right)| left - right),
        topk_overlap_count: overlap_count,
        topk_overlap_ratio: overlap_count as f64 / denom,
        topk_jaccard: if union_count == 0 {
            1.0
        } else {
            overlap_count as f64 / union_count as f64
        },
        baseline_best_score: baseline_best,
        candidate_best_score: candidate_best,
    }
}

fn print_topk_metrics(
    baseline_label: &str,
    candidate_label: &str,
    metrics: &TopKMetrics,
    baseline_time: Duration,
    candidate_time: Duration,
) {
    println!(
        "{baseline_label}={:.4}s {candidate_label}={:.4}s best_equal={}",
        baseline_time.as_secs_f64(),
        candidate_time.as_secs_f64(),
        format_bool(metrics.best_score_equal),
    );
    println!(
        "best_scores=({:?}, {:?}) best_gap={:?} overlap={}/{} overlap_ratio={:.4} jaccard={:.4}",
        metrics.baseline_best_score,
        metrics.candidate_best_score,
        metrics.best_score_gap,
        metrics.topk_overlap_count,
        TOP_K,
        metrics.topk_overlap_ratio,
        metrics.topk_jaccard,
    );
}

fn format_bool(value: bool) -> &'static str {
    if value { "YES" } else { "NO" }
}

fn make_options(combination_size: i32, max_solutions: i32) -> OptimizeOptions {
    OptimizeOptions {
        max_solutions,
        max_workers: BENCHMARK_MAX_WORKERS,
        use_gpu: true,
        combination_size,
        ..Default::default()
    }
}

fn make_constrained_benchmark_options(max_solutions: i32) -> OptimizeOptions {
    OptimizeOptions {
        min_attr_requirements: HashMap::from(CONSTRAINED_MIN_ATTR_REQUIREMENTS),
        ..make_options(COMBINATION_SIZE_FIVE, max_solutions)
    }
}

fn collect_attr_totals(modules: &[ModuleInfo]) -> HashMap<i32, i32> {
    let mut totals = HashMap::new();
    for module in modules {
        for part in &module.parts {
            *totals.entry(part.id).or_insert(0) += part.value;
        }
    }
    totals
}

fn assert_solution_meets_min_attr_requirements(
    solution: &ModuleSolution,
    requirements: &HashMap<i32, i32>,
) {
    let totals = collect_attr_totals(&solution.modules);
    for (&attr_id, &required_value) in requirements {
        let actual_value = totals.get(&attr_id).copied().unwrap_or_default();
        assert!(
            actual_value >= required_value,
            "attribute {attr_id} should be >= {required_value}, got {actual_value}",
        );
    }
}

fn assert_results_meet_min_attr_requirements(
    label: &str,
    results: &[ModuleSolution],
    options: &OptimizeOptions,
) {
    assert!(!results.is_empty(), "{label} should return results");
    let constrained_results: Vec<&ModuleSolution> = results
        .iter()
        .filter(|solution| solution.score > 0)
        .collect();
    assert!(
        !constrained_results.is_empty(),
        "{label} should contain at least one non-zero constrained result",
    );
    for solution in constrained_results {
        assert_eq!(
            solution.modules.len(),
            options.combination_size as usize,
            "{label} solution should match requested combination size",
        );
        assert_solution_meets_min_attr_requirements(solution, &options.min_attr_requirements);
    }
}

#[test]
#[ignore]
fn bench_cuda_opencl_comparison_five_modules_450_inputs() {
    let _guard = gpu_test_lock();
    let gpu_support = check_gpu_support();
    if !gpu_support.cuda_available || !gpu_support.opencl_available {
        println!("Skipping CUDA/OpenCL comparison: both backends are required");
        return;
    }

    let modules = generate_deterministic_modules(BENCHMARK_INPUT_MODULES, BENCHMARK_SEED);
    let options = make_options(COMBINATION_SIZE_FIVE, TOP_K as i32);

    let (cuda_result, cuda_time) =
        benchmark(|| strategy_enumeration_cuda(&modules, &options, None));
    let (opencl_result, opencl_time) =
        benchmark(|| strategy_enumeration_opencl(&modules, &options, None));

    assert!(!cuda_result.is_empty(), "CUDA should return results");
    assert!(!opencl_result.is_empty(), "OpenCL should return results");

    let cuda_scores = normalize_scores(extract_scores(&cuda_result));
    let opencl_scores = normalize_scores(extract_scores(&opencl_result));
    let metrics = compare_topk(&cuda_scores, &opencl_scores, TOP_K);

    println!("\n=== CUDA vs OpenCL (450 modules / 5-module combinations) ===");
    print_topk_metrics("cuda", "opencl", &metrics, cuda_time, opencl_time);
    println!("===========================================================\n");
}

#[test]
#[ignore]
fn bench_cuda_opencl_comparison_five_modules_450_inputs_with_constraints() {
    let _guard = gpu_test_lock();
    let gpu_support = check_gpu_support();
    if !gpu_support.cuda_available || !gpu_support.opencl_available {
        println!("Skipping constrained CUDA/OpenCL comparison: both backends are required");
        return;
    }

    let modules = generate_deterministic_modules(BENCHMARK_INPUT_MODULES, BENCHMARK_SEED);
    let options = make_constrained_benchmark_options(TOP_K as i32);

    let (cuda_result, cuda_time) =
        benchmark(|| strategy_enumeration_cuda(&modules, &options, None));
    let (opencl_result, opencl_time) =
        benchmark(|| strategy_enumeration_opencl(&modules, &options, None));

    assert_results_meet_min_attr_requirements("cuda", &cuda_result, &options);
    assert_results_meet_min_attr_requirements("opencl", &opencl_result, &options);

    let cuda_scores = normalize_scores(extract_positive_scores(&cuda_result));
    let opencl_scores = normalize_scores(extract_positive_scores(&opencl_result));
    let metrics = compare_topk(&cuda_scores, &opencl_scores, TOP_K);

    println!("\n=== CUDA vs OpenCL With Constraints ===");
    println!(
        "inputs={} top_k={} min_attr_requirements={:?}",
        BENCHMARK_INPUT_MODULES, TOP_K, options.min_attr_requirements
    );
    print_topk_metrics("cuda", "opencl", &metrics, cuda_time, opencl_time);
    println!("========================================\n");

    assert!(
        metrics.best_score_equal,
        "CUDA and OpenCL best scores should match under min attr constraints"
    );
}

#[test]
#[ignore]
fn bench_beam_search_accuracy_five_modules_450_inputs() {
    let _guard = gpu_test_lock();
    let gpu_support = check_gpu_support();
    if !gpu_support.cuda_available && !gpu_support.opencl_available {
        println!("Skipping beam search benchmark: no GPU enumeration backend available");
        return;
    }

    let modules = generate_deterministic_modules(BENCHMARK_INPUT_MODULES, BENCHMARK_SEED);
    let enumeration_options = make_options(COMBINATION_SIZE_FIVE, TOP_K as i32);
    let beam_options = make_options(COMBINATION_SIZE_FIVE, TOP_K as i32);

    let (baseline_result, baseline_time) =
        benchmark(|| strategy_enumeration_gpu(&modules, &enumeration_options, None));
    let (beam_result, beam_time) = benchmark(|| {
        strategy_beam_search_with_params(
            &modules,
            &beam_options,
            BENCHMARK_BEAM_WIDTH,
            BENCHMARK_EXPAND_PER_STATE,
            BENCHMARK_MAX_WORKERS,
            None,
        )
    });

    assert!(
        !baseline_result.is_empty(),
        "GPU enumeration should return results"
    );
    assert!(!beam_result.is_empty(), "Beam search should return results");

    let baseline_scores = normalize_scores(extract_scores(&baseline_result));
    let beam_scores = normalize_scores(extract_scores(&beam_result));
    let metrics = compare_topk(&baseline_scores, &beam_scores, TOP_K);

    println!("\n=== Beam Search Quality Benchmark ===");
    println!(
        "top_k={} beam_width={} expand_per_state={} combination_size={}",
        TOP_K, BENCHMARK_BEAM_WIDTH, BENCHMARK_EXPAND_PER_STATE, COMBINATION_SIZE_FIVE,
    );
    print_topk_metrics("baseline", "beam", &metrics, baseline_time, beam_time);
    println!("====================================\n");
}

#[test]
#[ignore]
fn bench_beam_search_accuracy_five_modules_450_inputs_with_constraints() {
    let _guard = gpu_test_lock();
    let gpu_support = check_gpu_support();
    if !gpu_support.cuda_available && !gpu_support.opencl_available {
        println!(
            "Skipping constrained beam search benchmark: no GPU enumeration backend available"
        );
        return;
    }

    let modules = generate_deterministic_modules(BENCHMARK_INPUT_MODULES, BENCHMARK_SEED);
    let enumeration_options = make_constrained_benchmark_options(TOP_K as i32);
    let beam_options = make_constrained_benchmark_options(TOP_K as i32);

    let (baseline_result, baseline_time) =
        benchmark(|| strategy_enumeration_gpu(&modules, &enumeration_options, None));
    let (beam_result, beam_time) = benchmark(|| {
        strategy_beam_search_with_params(
            &modules,
            &beam_options,
            BENCHMARK_BEAM_WIDTH,
            BENCHMARK_EXPAND_PER_STATE,
            BENCHMARK_MAX_WORKERS,
            None,
        )
    });

    assert_results_meet_min_attr_requirements("baseline", &baseline_result, &enumeration_options);
    assert_results_meet_min_attr_requirements("beam", &beam_result, &beam_options);

    let baseline_scores = normalize_scores(extract_positive_scores(&baseline_result));
    let beam_scores = normalize_scores(extract_positive_scores(&beam_result));
    let metrics = compare_topk(&baseline_scores, &beam_scores, TOP_K);

    println!("\n=== Beam Search Quality Benchmark With Constraints ===");
    println!(
        "inputs={} top_k={} beam_width={} expand_per_state={} combination_size={} min_attr_requirements={:?}",
        BENCHMARK_INPUT_MODULES,
        TOP_K,
        BENCHMARK_BEAM_WIDTH,
        BENCHMARK_EXPAND_PER_STATE,
        COMBINATION_SIZE_FIVE,
        beam_options.min_attr_requirements,
    );
    print_topk_metrics("baseline", "beam", &metrics, baseline_time, beam_time);
    println!("====================================\n");

    assert!(
        metrics.best_score_equal,
        "Beam search best score should match GPU enumeration under min attr constraints"
    );
    assert!(
        metrics.topk_overlap_ratio >= 0.6,
        "Beam search top-k overlap ratio should stay acceptable under min attr constraints"
    );
}
