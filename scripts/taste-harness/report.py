import json, os, glob, sys
E = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
def load(dir, prefix):
    vs = [json.load(open(f)) for f in sorted(glob.glob(f"{dir}/{prefix}-[12].json"))]
    return vs
def summarise(designers, prefix, arms):
    agg = {a: dict(changes=0, breaks=0, repeats=0, rank=0, n=0) for a in arms}
    pairs = {}
    per = {}
    for d in designers:
        for cell in sorted(glob.glob(f"{E}/{d}/t*/r*")):
            vs = load(cell, prefix)
            if not vs: continue
            m = {}
            for a in arms:
                xs = [v["screens"][a] for v in vs if a in v["screens"]]
                if not xs: continue
                L = lambda k: sum(len(x[k]) if isinstance(x[k], list) else x[k] for x in xs) / len(xs)
                m[a] = dict(changes=L("changes"), breaks=L("breaks"), repeats=L("repeats"),
                            rank=sum(v["rank"].index(a) + 1 for v in vs) / len(vs))
                for k in ["changes", "breaks", "repeats", "rank"]: agg[a][k] += m[a][k]
                agg[a]["n"] += 1
                per.setdefault((d, a), []).append(m[a]["changes"])
            for i, x in enumerate(arms):
                for y in arms[i + 1:]:
                    if x in m and y in m:
                        k = f"{x} vs {y}"; pairs.setdefault(k, [0, 0, 0])
                        pairs[k][0 if m[x]["rank"] < m[y]["rank"] else 2 if m[x]["rank"] > m[y]["rank"] else 1] += 1
    print(f"## {prefix} on {designers}")
    print("| arm | changes | breaks | repeats | rank | cells |\n|---|---|---|---|---|---|")
    for a in arms:
        g = agg[a]
        if g["n"]: print(f"| {a} | {g['changes']/g['n']:.2f} | {g['breaks']/g['n']:.2f} | {g['repeats']/g['n']:.2f} | {g['rank']/g['n']:.2f} | {g['n']} |")
    print("| pair | first wins | tie | second wins |\n|---|---|---|---|")
    for k, v in pairs.items(): print(f"| {k} | {v[0]} | {v[1]} | {v[2]} |")
    print("per designer mean changes:", {f"{d}{a}": round(sum(v)/len(v), 1) for (d, a), v in per.items()})
    print()
summarise(["d1", "d2", "d3", "d4", "d5"], "verdict", ["A", "B", "C", "D"])
summarise(["d2", "d4", "d5"], "verdict", ["A", "B", "C"])
summarise(["d2", "d4", "d5"], "verdict-e", ["B", "C", "E"])
summarise(["d2", "d4", "d5"], "verdict-f", ["B", "C", "F"])
summarise(["d2", "d4", "d5"], "verdict-cost", ["B", "F", "G", "H", "I"])
