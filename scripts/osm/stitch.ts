import type { OsmNode, OsmRelation, OsmWay } from './overpass'

/**
 * Chains ways end to end. Ways arrive unordered and may need reversing. A route
 * with a gap yields more than one chain, returned longest first.
 */
export function stitchWays(ways: number[][]): number[][] {
    const remaining = ways.filter((w) => w.length >= 2).map((w) => [...w])
    const chains: number[][] = []

    while (remaining.length > 0) {
        const chain = remaining.shift()!
        let extended = true

        while (extended) {
            extended = false
            for (let i = 0; i < remaining.length; i += 1) {
                const way = remaining[i]!
                const head = chain[0]!
                const tail = chain[chain.length - 1]!

                if (way[0] === tail) {
                    chain.push(...way.slice(1))
                } else if (way[way.length - 1] === tail) {
                    chain.push(...[...way].reverse().slice(1))
                } else if (way[way.length - 1] === head) {
                    chain.unshift(...way.slice(0, -1))
                } else if (way[0] === head) {
                    chain.unshift(...[...way].reverse().slice(0, -1))
                } else {
                    continue
                }

                remaining.splice(i, 1)
                extended = true
                break
            }
        }
        chains.push(chain)
    }

    return chains.sort((a, b) => b.length - a.length)
}

/** The relation's longest continuous chain, as [lon, lat] positions. */
export function relationToLine(
    relation: OsmRelation,
    ways: Iterable<OsmWay>,
    nodes: Iterable<OsmNode>,
): [number, number][] {
    const wayById = new Map<number, OsmWay>()
    for (const w of ways) {
        wayById.set(w.id, w)
    }
    const nodeById = new Map<number, OsmNode>()
    for (const n of nodes) {
        nodeById.set(n.id, n)
    }

    // Members with a role are stops and platforms; only roleless ways form the path.
    const path = relation.members
        .filter((m) => m.type === 'way' && m.role === '')
        .map((m) => wayById.get(m.ref))
        .filter((w): w is OsmWay => w !== undefined)
        .map((w) => w.nodes)

    const [longest] = stitchWays(path)
    if (!longest) {
        return []
    }

    return longest
        .map((id) => nodeById.get(id))
        .filter((n): n is OsmNode => n !== undefined)
        .map((n) => [n.lon, n.lat] as [number, number])
}
