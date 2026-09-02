import { expandFrequencies } from './expandFrequencies'
import type { Line, Network, Pattern, Service, Stop, Trip } from '../types/network'

export interface StopPosition {
	pattern: Pattern
	index: number
}

export interface NetworkIndex {
	network: Network
	stops: Map<string, Stop>
	lines: Map<string, Line>
	patterns: Map<string, Pattern>
	services: Service[]
	tripsByPattern: Map<string, Trip[]>
	patternsByStop: Map<string, StopPosition[]>
	linesByStop: Map<string, Line[]>
}

export function buildIndex(net: Network): NetworkIndex {
	const stops = new Map(net.stops.map((s) => [s.id, s]))
	const lines = new Map(net.lines.map((l) => [l.id, l]))
	const patterns = new Map(net.patterns.map((p) => [p.id, p]))

	const tripsByPattern = new Map<string, Trip[]>()
	for (const trip of expandFrequencies(net)) {
		const list = tripsByPattern.get(trip.pattern)
		if (list) {
			list.push(trip)
		} else {
			tripsByPattern.set(trip.pattern, [trip])
		}
	}

	const patternsByStop = new Map<string, StopPosition[]>()
	const lineIdsByStop = new Map<string, Set<string>>()
	for (const pattern of net.patterns) {
		pattern.stops.forEach((stopId, index) => {
			const list = patternsByStop.get(stopId)
			if (list) {
				list.push({ pattern, index })
			} else {
				patternsByStop.set(stopId, [{ pattern, index }])
			}

			const seen = lineIdsByStop.get(stopId)
			if (seen) {
				seen.add(pattern.line)
			} else {
				lineIdsByStop.set(stopId, new Set([pattern.line]))
			}
		})
	}

	const linesByStop = new Map<string, Line[]>()
	for (const [stopId, ids] of lineIdsByStop) {
		const list = [...ids]
			.map((id) => lines.get(id))
			.filter((l): l is Line => l !== undefined)
			.sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
		linesByStop.set(stopId, list)
	}

	return { network: net, stops, lines, patterns, services: net.services, tripsByPattern, patternsByStop, linesByStop }
}
