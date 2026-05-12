declare const _default: {
    content: string[];
    theme: {
        extend: {};
    };
    darkMode: "class";
    plugins: {
        handler: import("tailwindcss/types/config").PluginCreator;
        config?: Partial<import("tailwindcss/types/config").Config>;
    }[];
};
export default _default;
