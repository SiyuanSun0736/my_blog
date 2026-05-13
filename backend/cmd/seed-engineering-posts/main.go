package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"wanderlust/backend/internal/blog"
)

func main() {
	if os.Getenv("BLOG_REPLACE_POSTS_CONFIRM") != "1" {
		log.Fatal("set BLOG_REPLACE_POSTS_CONFIRM=1 before replacing existing posts")
	}

	ctx := context.Background()
	service, err := blog.NewService(ctx, mongoURI(), mongoDatabase())
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()

	posts, err := service.ReplaceAllPosts(ctx, engineeringPosts())
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("replaced posts: %d\n", len(posts))
	for _, post := range posts {
		fmt.Printf("- %s (%s)\n", post.Title, post.Slug)
	}
}

func mongoURI() string {
	if value := os.Getenv("MONGODB_URI"); value != "" {
		return value
	}

	return "mongodb://localhost:27017"
}

func mongoDatabase() string {
	if value := os.Getenv("MONGODB_DATABASE"); value != "" {
		return value
	}

	return "wanderlust"
}

func engineeringPosts() []blog.CreatePostInput {
	return []blog.CreatePostInput{
		{
			Slug:        "ssa-pass-regression-notes",
			Title:       "一次 SSA Pass 回归是怎么被定位出来的",
			Summary:     "从 flamegraph、IR diff 和 microbenchmark 三条线并行排查一处编译器回归，最后把问题收敛到错误的 pass 交互上。",
			Category:    "Compiler / Perf",
			Tags:        []string{"compiler", "ssa", "perf", "benchmark"},
			Author:      "Wanderlust",
			PublishedAt: "2026-05-08",
			Featured:    true,
			Accent:      "linear-gradient(135deg, #0f766e 0%, #d96c3d 100%)",
			Body: `# 一次 SSA Pass 回归是怎么被定位出来的

一次编译器性能回归，最难的往往不是修复，而是先证明问题到底属于哪一层。

这次回归的表象很简单：同一组 benchmark 在开启新 pass 顺序之后，吞吐掉了约 11%。真正的排查过程却分成了三条线：

## 1. 先确认不是测量噪声

- 固定 CPU governor
- 绑定单 NUMA node
- 对同一输入跑 20 次取中位数

只有当波动范围收敛后，后面的 IR 对比才有意义。

## 2. 看 flamegraph，不要先看 intuition

第一反应通常是“新 pass 太重了”，但 flamegraph 显示热点其实落在一个旧的 cleanup pass 里。

这说明问题不是单个 pass 的绝对成本，而是前后两个阶段之间制造了额外工作量。

## 3. 用 IR diff 收敛交互面

把同一函数在新旧 pipeline 下的 IR 导出来后，差异主要集中在：

1. phi 节点数量上升
2. copy propagation 命中率下降
3. loop simplify 之后又被反向打散

最后定位到的问题是：一个本来只想补 canonical form 的 pass，在某些 block layout 下把后续 pass 的假设破坏了。

## 修复思路

修复没有走“把 pass 关掉”这条最短路，而是做了两件更稳的事：

- 缩小 pass 生效范围
- 给 pipeline 加一组 IR-level regression test

## 结论

编译器里的 perf 回归，通常不是单点超时，而是多个阶段之间的协作关系出了问题。先把测量、热点和 IR 变化拆开，排查成本会明显下降。`,
		},
		{
			Slug:        "cuda-training-pipeline-checklist",
			Title:       "训练任务上 GPU 前先做哪几步检查",
			Summary:     "把数据管线、显存预算、吞吐监控和 checkpoint 策略提前固定，能少掉很多无意义的重跑。",
			Category:    "Deep Learning",
			Tags:        []string{"deep-learning", "cuda", "training", "ops"},
			Author:      "Wanderlust",
			PublishedAt: "2026-05-06",
			Featured:    false,
			Accent:      "linear-gradient(135deg, #d96c3d 0%, #111827 100%)",
			Body: `# 训练任务上 GPU 前先做哪几步检查

训练任务最浪费时间的环节，往往不是模型本身，而是那些本来可以在 CPU 阶段提前暴露的问题。

## 数据进入 GPU 之前

我会先确认下面几件事：

- dataset split 是否稳定可复现
- dataloader 是否已经把 IO 和 decode 开销压平
- batch size 与梯度累积的组合能否在目标卡型上稳定跑满

## 显存预算不要靠感觉

在真正提交长任务之前，先用一小段 warmup step 记录：

1. model weights
2. optimizer state
3. activation peak
4. 临时 buffer

如果这一步不做，后面所有 OOM 都会变成“边跑边猜”。

## 指标观察要区分训练问题和系统问题

我通常把监控拆成两层：

- 训练指标：loss、lr、grad norm
- 系统指标：GPU util、host memory、PCIe throughput、dataloader wait

只有这两层一起看，才能判断是模型收敛不好，还是系统根本没喂饱 GPU。

## checkpoint 策略

checkpoint 不是为了“有个备份”而存在，而是为了降低长任务失败后的回滚成本。

对长任务来说，固定 checkpoint cadence、异步上传和恢复演练，比继续堆训练技巧更实际。

## 结语

深度学习工程里最值得写下来的，往往不是最终曲线，而是那些让训练过程稳定、可解释、可恢复的检查表。`,
		},
		{
			Slug:        "makefile-release-pipeline-notes",
			Title:       "把 Makefile 从能用整理到能维护",
			Summary:     "发布脚本不该只追求一键成功，更要能读、能拆、能在出错时快速定位阶段边界。",
			Category:    "Build Systems",
			Tags:        []string{"make", "automake", "release", "tooling"},
			Author:      "Wanderlust",
			PublishedAt: "2026-05-03",
			Featured:    false,
			Accent:      "linear-gradient(135deg, #1f2937 0%, #0f766e 100%)",
			Body: `# 把 Makefile 从能用整理到能维护

很多仓库里的 Makefile 都能跑，但不一定能维护。

## 先拆阶段，再谈一键入口

我现在更偏向先把流程拆成清晰 target：

- lint
- build
- package
- publish
- verify

最后再给一个总入口去串起来。这样做的好处是，失败时不用从头再跑整条链路。

## 变量边界要干净

最容易把 Makefile 写脏的地方，是环境变量和默认值混在一起。

更稳的做法是：

1. 给外部可覆盖的变量留默认值
2. 把内部临时变量限制在单个 target 内部
3. 明确哪些参数会进入最终产物命名

## 输出日志要能帮助定位阶段

如果日志只剩一串 shell 命令，出错后几乎没有上下文。

我通常会在关键阶段输出：

- 当前 target
- 输入产物
- 输出目录
- 失败后建议先检查的文件

## 为什么这和 perf 一样重要

构建系统不是纯粹的辅助设施。它决定了变更从代码进入产物的路径是否稳定，也决定了 CI 和手工发布时的认知负担。`,
		},
		{
			Slug:        "kubernetes-incident-runbook",
			Title:       "一次 Kubernetes 线上抖动后的最小化排障手册",
			Summary:     "先切分 control plane、network、workload 和 rollout 四层，再决定该看事件、日志还是节点状态。",
			Category:    "Kubernetes / Ops",
			Tags:        []string{"kubernetes", "sre", "runbook", "debugging"},
			Author:      "Wanderlust",
			PublishedAt: "2026-04-29",
			Featured:    false,
			Accent:      "linear-gradient(135deg, #0f172a 0%, #d96c3d 100%)",
			Body: `# 一次 Kubernetes 线上抖动后的最小化排障手册

Kubernetes 出问题时，最怕一上来就同时看 deployment、pod log、node metrics 和 ingress 配置，最后把自己淹没在噪音里。

## 我会先分四层

1. control plane 有没有异常
2. network 路径是不是断了
3. workload 自己是不是已经不健康
4. rollout 最近有没有引入新问题

## 先看事件，再看日志

事件虽然粗，但特别适合快速定位：

- 调度失败
- 拉镜像失败
- readiness 探针超时
- node pressure

如果事件已经把问题面缩到一个 namespace 或一个 node，再去翻日志才不会失控。

## rollout 要看 diff，不要只看状态

很多“突然发生”的故障，其实是最近一次变更把资源边界或者探针时序改坏了。

所以我通常会把：

- deployment revision
- config change
- image tag
- resource requests/limits

一起对比，而不是只看 pod 目前是 Running 还是 CrashLoopBackOff。

## 写 runbook 的目的

runbook 不是为了把所有命令记下来，而是为了让团队在压力下还能按同一套路径收敛问题。`,
		},
	}
}
