//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import storybook from 'eslint-plugin-storybook'
import react from 'eslint-plugin-react'

export default [
    ...tanstackConfig,
    ...storybook.configs['flat/recommended'],
    // Don't lint:
    //  - Root-level JS config files (not in any tsconfig; tanstack's typed rules crash on them)
    //  - Generated artifacts (there are none of these yet, but the pattern is cheap to keep)
    //  - Build output
    {
        ignores: ['eslint.config.js', 'prettier.config.js', '**/*.auto-generated.*', 'dist/**', 'storybook-static/**'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.app.json', './tsconfig.node.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            'import/no-default-export': 'error',
        },
    },
    {
        // Storybook reads the story meta off the default export, and ambient module
        // declarations (`declare module '*?as=metadata'`) can only export default.
        files: ['**/*.stories.{ts,tsx}', '**/*.d.ts'],
        rules: {
            'import/no-default-export': 'off',
        },
    },
    {
        plugins: { react },
        settings: { react: { version: 'detect' } },
        rules: {
            '@typescript-eslint/array-type': ['error', { default: 'array' }],
            'react/function-component-definition': [
                'error',
                {
                    namedComponents: 'arrow-function',
                    unnamedComponents: 'arrow-function',
                },
            ],
            'import/extensions': [
                'error',
                'never',
                {
                    png: 'always',
                    jpg: 'always',
                    jpeg: 'always',
                    gif: 'always',
                    svg: 'always',
                    webp: 'always',
                    avif: 'always',
                    ico: 'always',
                    css: 'always',
                    scss: 'always',
                    json: 'always',
                    yaml: 'always',
                    yml: 'always',
                    gen: 'always',
                    config: 'always',
                    schema: 'always',
                },
            ],
        },
    },
]
