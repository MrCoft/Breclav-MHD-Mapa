import type { Meta } from '../types/network'

/**
 * Formats a `YYYY-MM-DD` feed date in Czech, without letting the viewer's timezone shift it by a
 * day — `new Date('2026-08-28')` parses as UTC midnight, which `Intl.DateTimeFormat` would then
 * render in local time. Building the `Date` from its parts instead keeps it anchored to local
 * midnight, matching what `Intl.DateTimeFormat` (no explicit `timeZone`) reads back.
 */
function formatFeedDate(feedDate: string): string {
    const [year, month, day] = feedDate.split('-').map(Number)
    const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
    return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' }).format(date)
}

const LINK_CLASS = 'underline hover:text-slate-700'

const KordisLink = () => (
    <a
        href="https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328/about"
        target="_blank"
        rel="noreferrer"
        className={LINK_CLASS}
    >
        KORDIS JMK
    </a>
)

/**
 * The data-source credit — the one line of the footer that actually differs by scenario (finding
 * I9). "current" is entirely KORDIS JMK's GTFS feed. The proposed network's city lines instead
 * come from the petition's own spreadsheet (`docs/decisions.md` #18, "Prinz návrh jízdních řádů
 * 2026") — a citizen-authored document, not the transit authority — while its two inherited lines
 * (`meta.inheritedLines`) are still KORDIS JMK's own unchanged data. Crediting every scenario as
 * "KORDIS JMK" regardless, as this used to, misattributed the proposal's own timetables to the
 * authority that didn't write them.
 */
const DataCredit = ({ meta }: { meta: Meta }) => {
    if (meta.inheritedLines === undefined) {
        return (
            <span>
                Data: <KordisLink /> (CC BY 4.0)
            </span>
        )
    }
    return (
        <span>
            Data: petice „Prinz návrh jízdních řádů 2026“; linky {meta.inheritedLines.lines.join(', ')} beze změny z{' '}
            <KordisLink /> (CC BY 4.0)
        </span>
    )
}

/**
 * A licence obligation, not decoration: the timetable data is CC-BY-4.0, OpenStreetMap requires
 * ODbL attribution, and roughly half the drawn route geometry comes from OSRM. MapLibre's own
 * attribution control (on the map) covers the basemap tile source only — it knows nothing about
 * the data this project bakes in, which is what this footer covers.
 */
export const Footer = ({ meta }: { meta: Meta }) => {
    return (
        <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
            <span>Jízdní řády k {formatFeedDate(meta.feedDate)}.</span>
            <DataCredit meta={meta} />
            <span>
                Mapové podklady:{' '}
                <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    className={LINK_CLASS}
                >
                    © OpenStreetMap přispěvatelé
                </a>{' '}
                (ODbL)
            </span>
            <span>
                Trasy:{' '}
                <a href="https://project-osrm.org/" target="_blank" rel="noreferrer" className={LINK_CLASS}>
                    OSRM
                </a>
            </span>
        </footer>
    )
}
