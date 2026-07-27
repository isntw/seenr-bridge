// Component-level theming. Deliberately almost empty: the app takes Nuxt UI's
// packaged look for shape, elevation and variants, and overrides only the palette.
//
// There used to be a block here per component — card radius and shadow, rounded-lg
// buttons/inputs/menus, bg-panel modal and dropdown surfaces, a blurred overlay, a
// white switch thumb, pill badges, and five compound variants pinning solid buttons
// to the -600 shade with white text. All of it reproduced the pre-Nuxt design, and
// all of it has been dropped: matching the component library beats matching a design
// that no longer exists, and every override was one more thing to re-check on a
// Nuxt UI upgrade.
//
// Surface *colours* still live in app/assets/css/main.css as design tokens, which is
// how the app stays dark without per-component work.
export default defineAppConfig({
  ui: {
    // The one thing kept. Nuxt UI defaults the semantic hues to green/blue/yellow/
    // red; this is the app's identity, and setting it here colours every badge,
    // alert, status rail and stat tile in one place.
    colors: {
      primary: 'violet',
      secondary: 'fuchsia', // only used for the logo gradient's far end
      success: 'emerald',
      info: 'sky',
      warning: 'amber',
      error: 'rose',
      neutral: 'slate',
    },
  },
})
