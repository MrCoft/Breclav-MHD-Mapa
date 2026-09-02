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

/**
 * A licence obligation, not decoration: the timetable data is CC-BY-4.0, OpenStreetMap requires
 * ODbL attribution, and roughly half the drawn route geometry comes from OSRM. MapLibre's own
 * attribution control (on the map) covers the basemap tile source only — it knows nothing about
 * the data this project bakes in, which is what this footer covers.
 */
export const Footer = ({ feedDate }: { feedDate: string }) => {
    return (
        <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
            <span>Jízdní řády k {formatFeedDate(feedDate)}.</span>
            <span>
                Data:{' '}
                <a
                    href="https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328/about"
                    target="_blank"
                    rel="noreferrer"
                    className={LINK_CLASS}
                >
                    KORDIS JMK
                </a>{' '}
                (CC BY 4.0)
            </span>
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
