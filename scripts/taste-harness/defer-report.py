# The design-system test with the line that defers to it (design-system.mjs judgeDefer): for each way,
# the judge's changes, repeats, taste points broken and mean rank of six, and the oracle's share of
# measurable points broken; then SPD against SP and against S, paired by judging.
# usage: python3 -I scripts/taste-harness/defer-report.py <dir> [designers…]
import glob, json, os, statistics, sys

root = sys.argv[1]
designers = sys.argv[2:] or ["d2", "d4", "d5"]
ways = {"Design system alone (S)": ["S", "S2"], "Design system and takes (SP)": ["SP", "SP2"], "And the line deferring to it (SPD)": ["SPD", "SPD2"]}
size = lambda x: len(x) if isinstance(x, list) else x
verdicts = [json.load(open(f)) for d in designers for f in sorted(glob.glob(os.path.join(root, d, "rounds", "r[456]", "verdict-dsd-*.json")))]
scores = json.load(open(os.path.join(root, "measure-scores.json")))


def broken(arms):
    out = []
    for k, p in scores.items():
        dn, r, arm = k.split("/")
        if dn in designers and r in ("r4", "r5", "r6") and arm in arms:
            known = [x for x in p.values() if x is not None]
            if known:
                out.append(sum(x is False for x in known) / len(known))
    return out


print("| Way | Changes | Repeats | Taste points broken | Mean rank of 6 | Measurable points broken |")
print("| --- | ---: | ---: | ---: | ---: | ---: |")
for name, arms in ways.items():
    pick = lambda key: [size(v["screens"][a][key]) for v in verdicts for a in arms if a in v["screens"]]
    rank = [v["rank"].index(a) + 1 for v in verdicts for a in arms if a in v["rank"]]
    print(f"| {name} | {statistics.mean(pick('changes')):.1f} | {statistics.mean(pick('repeats')):.1f} | {statistics.mean(pick('breaks')):.1f} | {statistics.mean(rank):.2f} | {100 * statistics.mean(broken(arms)):.0f}% |")
for a, b in (("SPD", "SP"), ("SPD", "S"), ("SP", "S")):
    above = below = level = 0
    for v in verdicts:
        ra = [v["rank"].index(x) for x in (a, a + "2") if x in v["rank"]]
        rb = [v["rank"].index(x) for x in (b, b + "2") if x in v["rank"]]
        if not ra or not rb:
            continue
        d = statistics.mean(ra) - statistics.mean(rb)
        above += d < 0
        below += d > 0
        level += d == 0
    print(f"{a} ranked above {b} in {above} judgings, below in {below}, level in {level}.")
