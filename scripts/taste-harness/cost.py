# What each screen cost, from the logs of the builds that ran with a check (arms F to I): the
# whole build, the check's part of it, the builder's output, and how many images each opened. The
# check's part on a model shared with the builder is its share of the tokens, weighted as the API
# prices them (cache reads 0.1, cache writes 1.25, output 5); the output of each is from the result.
# usage: python3 -I scripts/taste-harness/cost.py <dir> [arms…]   (<dir> holds run.mjs's designers)
import glob, json, os, sys, statistics

root = sys.argv[1]
arms = sys.argv[2:] or ["F", "G", "H", "I"]


def read(log):
    last, checks, opened, seen = None, 0, {"builder": 0, "check": 0}, {}
    for line in open(log):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "result":
            last = e
        if e.get("type") != "assistant":
            continue
        who = "check" if e.get("parent_tool_use_id") else "builder"
        m = e["message"]
        seen.setdefault(m.get("id"), (who, m.get("model", ""), m.get("usage") or {}))
        for c in e["message"].get("content", []):
            if c.get("type") != "tool_use":
                continue
            if c["name"] == "Agent" and c["input"].get("subagent_type") == "pinch-check":
                checks += 1
            if c["name"] == "Read" and c["input"].get("file_path", "").endswith(".png") and "render" not in c["input"]["file_path"]:
                opened[who] += 1
    if not last:
        return None
    usage = last.get("modelUsage") or {}
    models = {m.split("-")[1]: u.get("costUSD", 0) for m, u in usage.items()}
    weigh = lambda u: (u.get("input_tokens", 0) or 0) + 0.1 * (u.get("cache_read_input_tokens", 0) or 0) + 1.25 * (u.get("cache_creation_input_tokens", 0) or 0)
    check = 0.0
    for model, u in usage.items():
        mine = [x for x in seen.values() if x[1] == model]
        theirs = sum(weigh(x[2]) for x in mine if x[0] == "check")
        if not theirs:
            continue
        everyone = sum(weigh(x[2]) for x in mine)
        if all(x[0] == "check" for x in mine):
            check += u.get("costUSD", 0)
        else:
            # The model's input side split by share; its output counted whole to the builder.
            out = 5 * (u.get("outputTokens", 0) or 0)
            check += u.get("costUSD", 0) * theirs / (everyone + out)
    builder_out = sum((u.get("outputTokens", 0) or 0) for m, u in usage.items() if any(x[1] == m and x[0] == "builder" for x in seen.values()))
    return {"cost": sum(models.values()), "check_cost": check, "out": builder_out, "models": models, "checks": checks, **opened}


for arm in arms:
    rows = [r for r in (read(f) for f in sorted(glob.glob(os.path.join(root, "d*", "t*", "r*", arm, "log.txt")))) if r]
    if not rows:
        continue
    mean = lambda k: statistics.mean(r[k] for r in rows)
    by_model = {}
    for r in rows:
        for m, c in r["models"].items():
            by_model[m] = by_model.get(m, 0) + c / len(rows)
    print(
        f"{arm}: {len(rows)} screens, ${mean('cost'):.2f} a screen "
        f"({', '.join(f'{m} ${c:.2f}' for m, c in by_model.items())}), "
        f"the check ${mean("check_cost"):.3f}, builder output {mean('out')/1000:.1f}k tokens, "
        f"checks run {sum(r['checks'] > 0 for r in rows)}/{len(rows)}, "
        f"images opened: builder {mean('builder'):.1f}, check {mean('check'):.1f}"
    )
