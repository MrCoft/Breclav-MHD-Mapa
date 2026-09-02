import type { Network, Trip } from '../types/network'

export function expandFrequencies(net: Network): Trip[] {
	const trips = [...net.trips]
	for (const block of net.frequencies ?? []) {
		if (block.headway <= 0) {
			throw new Error(`Frequency block on ${block.pattern} has non-positive headway ${block.headway}`)
		}
		for (let start = block.from; start <= block.to; start += block.headway) {
			trips.push({ pattern: block.pattern, service: block.service, start })
		}
	}
	return trips
}
