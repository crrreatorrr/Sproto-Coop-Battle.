// Runs the Coop server bundle inside dop251/goja. One VM prints the golden
// JSON. With -parallel N, N independent VMs each time a few authoritative loops.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"sync"
	"time"

	"github.com/dop251/goja"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func read(path string) string {
	b, err := os.ReadFile(path)
	must(err)
	return string(b)
}

func newVM() *goja.Runtime {
	vm := goja.New()
	console := vm.NewObject()
	must(console.Set("log", func(call goja.FunctionCall) goja.Value {
		parts := make([]string, len(call.Arguments))
		for i, arg := range call.Arguments {
			parts[i] = arg.String()
		}
		fmt.Println(join(parts))
		return goja.Undefined()
	}))
	must(vm.Set("console", console))
	return vm
}

func join(parts []string) string {
	out := ""
	for i, part := range parts {
		if i > 0 {
			out += " "
		}
		out += part
	}
	return out
}

func runScript(vm *goja.Runtime, filename, source string) {
	_, err := vm.RunScript(filename, source)
	if err != nil {
		panic(fmt.Errorf("%s: %w", filename, err))
	}
}

func parallel(bundle string, n int) {
	const loops = 40
	var mu sync.Mutex
	var samples []float64
	var wg sync.WaitGroup
	errs := make(chan error, n)
	start := time.Now()
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			defer func() {
				if rec := recover(); rec != nil {
					errs <- fmt.Errorf("vm %d: %v", i, rec)
				}
			}()
			vm := newVM()
			origin := time.Now()
			must(vm.Set("nowMs", func(goja.FunctionCall) goja.Value {
				return vm.ToValue(float64(time.Since(origin).Microseconds()) / 1000)
			}))
			runScript(vm, "coop-sim.js", bundle)
			script := fmt.Sprintf(`
				var made = CoopProtocol.createMatch({ mode: 'banked', seed: %d, matchId: 'bench-%d' });
				if (!made.ok) throw new Error(made.reason);
				var session = made.session;
				CoopProtocol.assignSeat(session, { accountId: 'bench', generation: 1, device: 'k1', slot: 0 });
				var frames = [null, null, null];
				for (var warm = 0; warm < 8; warm++) {
					var warmed = CoopProtocol.stepLoop(session, frames, 1000 + warm * 50);
					if (!warmed.ok) throw new Error(warmed.reason);
				}
				var worst = 0;
				var total = 0;
				var samples = [];
				for (var loop = 0; loop < %d; loop++) {
					var t0 = nowMs();
					var stepped = CoopProtocol.stepLoop(session, frames, 5000 + loop * 50);
					if (!stepped.ok) throw new Error(stepped.reason);
					var dt = nowMs() - t0;
					samples.push(dt);
					total += dt;
					if (dt > worst) worst = dt;
				}
				JSON.stringify({ worst: worst, mean: total / %d, tick: session.state.t, lives: session.state.players[0].lives, samples: samples });
			`, 1000+i, i, loops, loops)
			v, err := vm.RunString(script)
			must(err)
			var row struct {
				Worst   float64   `json:"worst"`
				Mean    float64   `json:"mean"`
				Tick    float64   `json:"tick"`
				Lives   float64   `json:"lives"`
				Samples []float64 `json:"samples"`
			}
			must(json.Unmarshal([]byte(v.String()), &row))
			if row.Tick != float64((loops+8)*3) || len(row.Samples) != loops {
				errs <- fmt.Errorf("vm %d tick %v samples %d", i, row.Tick, len(row.Samples))
				return
			}
			mu.Lock()
			samples = append(samples, row.Samples...)
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		panic(err)
	}
	sort.Float64s(samples)
	p95 := samples[(len(samples)*95)/100]
	sum := 0.0
	for _, sample := range samples {
		sum += sample
	}
	report := map[string]any{
		"vms":        n,
		"loopsEach":  loops,
		"samples":    len(samples),
		"substeps":   3,
		"meanLoopMs": sum / float64(len(samples)),
		"maxLoopMs":  samples[len(samples)-1],
		"p95LoopMs":  p95,
		"wallMs":     time.Since(start).Milliseconds(),
		"go":         runtime.Version(),
		"gomaxprocs": runtime.GOMAXPROCS(0),
	}
	enc, err := json.Marshal(report)
	must(err)
	fmt.Println(string(enc))
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: goja-runner <bundle.js> [sha256.js scenarios.js entry.js] | goja-runner -parallel <bundle.js>")
		os.Exit(2)
	}
	if os.Args[1] == "-parallel" {
		parallel(read(os.Args[2]), 10)
		return
	}
	vm := newVM()
	for _, path := range os.Args[1:] {
		runScript(vm, path, read(path))
	}
}
