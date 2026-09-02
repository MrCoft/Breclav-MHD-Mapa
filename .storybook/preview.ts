import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import '../src/styles/globals.css'

const preview: Preview = {
    decorators: [
        withThemeByClassName({
            themes: { light: '', dark: 'dark' },
            defaultTheme: 'light',
        }),
    ],
    parameters: {
        options: {
            storySort: {
                order: ['Lab', 'Design System', 'Components'],
            },
        },
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
        viewport: {
            viewports: {
                mobile: {
                    name: 'Mobile',
                    styles: { width: '375px', height: '667px' },
                    type: 'mobile',
                },
                tablet: {
                    name: 'Tablet',
                    styles: { width: '768px', height: '1024px' },
                    type: 'tablet',
                },
                desktop: {
                    name: 'Desktop',
                    styles: { width: '1440px', height: '900px' },
                    type: 'desktop',
                },
            },
        },
    },
}

export default preview
