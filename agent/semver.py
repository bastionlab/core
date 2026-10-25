"""x.y.z versions and the ranges add-ons declare (addon.yaml `core: ">=0.2.0"`), shared by addon-get and core-update.

A range is space-separated comparators (>=0.2.0 <1.0.0), a caret (^0.2.0 = same major, or same minor below 1.0)
or a bare version (= that one). A pre-release (0.3.0-beta.1) sorts before its release.
"""
import re

_V = re.compile(r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$")


def parse(v):
    m = _V.match(str(v or "").strip())
    if not m:
        raise ValueError(f"not a version: {v!r}")
    a, b, c, pre = m.groups()
    # no pre-release sorts after any pre-release of the same x.y.z
    return (int(a), int(b or 0), int(c or 0), (1, "") if pre is None else (0, pre))


def newer(a, b):
    return parse(a) > parse(b)


def satisfies(version, spec):
    spec = str(spec or "").strip()
    if not spec or spec == "*":
        return True
    v = parse(version)
    for part in spec.split():
        if part.startswith("^"):
            lo = parse(part[1:])
            hi = (lo[0] + 1, 0, 0, (0, "")) if lo[0] else (0, lo[1] + 1, 0, (0, ""))
            ok = lo <= v < hi
        else:
            m = re.match(r"^(>=|<=|>|<|=)?(.+)$", part)
            op, w = m.group(1) or "=", parse(m.group(2))
            ok = {">=": v >= w, "<=": v <= w, ">": v > w, "<": v < w, "=": v[:3] == w[:3]}[op]
        if not ok:
            return False
    return True


if __name__ == "__main__":
    assert satisfies("0.2.0", ">=0.1.0") and not satisfies("0.1.0", ">=0.2.0")
    assert satisfies("0.2.5", "^0.2.0") and not satisfies("0.3.0", "^0.2.0") and satisfies("1.4.0", "^1.2")
    assert satisfies("0.5.0", ">=0.2.0 <1.0.0") and not satisfies("1.0.0", ">=0.2 <1")
    assert newer("0.3.0", "0.3.0-beta.2") and newer("0.3.0-beta.2", "0.3.0-beta.1") and not newer("0.2.9", "0.3.0")
    assert satisfies("0.3.0", "0.3") and satisfies("0.3.0", "=0.3.0")
    print("ok")
