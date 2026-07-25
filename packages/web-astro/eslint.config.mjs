import baseConfig from "../../eslint.config.mjs";

export default [
    ...baseConfig,
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx",
            "**/*.astro"
        ],
        // Override or add rules here
        rules: {}
    },
    {
        files: [
            "env.d.ts"
        ],
        rules: {
            "@typescript-eslint/triple-slash-reference": "off"
        }
    },
    {
        ignores: [
            "dist",
            ".astro",
            "vitest.config.mts"
        ]
    }
];
