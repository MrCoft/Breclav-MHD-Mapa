import type { StorybookConfig } from '@storybook/react-vite'

export default {
    stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
    addons: ['@storybook/addon-themes'],
    framework: {
        name: '@storybook/react-vite',
        options: {},
    },
} as StorybookConfig
