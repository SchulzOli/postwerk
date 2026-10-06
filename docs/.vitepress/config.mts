import { defineConfig } from 'vitepress';

const repo = 'https://github.com/SchulzOli/postwerk';

/**
 * Postwerk's documentation website, published to GitHub Pages
 * (https://schulzoli.github.io/postwerk/). The pages are the Markdown files in
 * docs/, so they read the same on GitHub.
 */
export default defineConfig({
  title: 'Postwerk',
  description: 'Self-hosted social media scheduling: write once, publish everywhere.',
  base: '/postwerk/',
  cleanUrls: true,
  // Broken links never fail the build: scripts/check-links.mjs reports them as warnings.
  ignoreDeadLinks: true,
  srcExclude: ['scripts/**', 'node_modules/**'],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/postwerk/icon.svg' }]],
  themeConfig: {
    logo: '/icon.svg',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Networks', link: '/networks/' },
      { text: 'Roadmap', link: '/plan' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'About and legal pages', link: '/legal' },
          { text: 'Themes', link: '/themes' },
        ],
      },
      {
        text: 'Networks',
        items: [
          { text: 'Choose how to offer each network', link: '/networks/' },
          { text: 'App reviews', link: '/networks/reviews' },
          { text: 'Mastodon, Bluesky, Telegram, Discord', link: '/networks/open' },
          { text: 'Facebook, Instagram, Threads', link: '/networks/meta' },
          { text: 'LinkedIn', link: '/networks/linkedin' },
          { text: 'X', link: '/networks/x' },
          { text: 'TikTok', link: '/networks/tiktok' },
          { text: 'YouTube and Business Profile', link: '/networks/google' },
          { text: 'Pinterest', link: '/networks/pinterest' },
          { text: 'Reddit', link: '/networks/reddit' },
          { text: 'The Zernio bridge', link: '/bridge' },
          { text: 'Status and known gaps', link: '/platforms' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Roadmap', link: '/plan' },
          { text: 'Contributing', link: `${repo}/blob/main/CONTRIBUTING.md` },
          { text: 'Security', link: `${repo}/blob/main/SECURITY.md` },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: { message: 'Released under the MIT License.', copyright: 'Postwerk contributors' },
  },
});
