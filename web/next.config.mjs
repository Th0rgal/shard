import nextra from "nextra";

const withNextra = nextra({
  latex: true,
  search: {
    codeblocks: false,
  },
  contentDirBasePath: "/docs",
});

export default withNextra({
  reactStrictMode: true,
  experimental: {
    optimizeCss: false,
  },
  images: {
    unoptimized: true,
  },
});
