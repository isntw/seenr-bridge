// Component-level theming. Anything that is a *surface* colour lives in
// app/assets/css/main.css as a design token; this file is for shape (radius,
// shadow) and for the handful of variants whose Nuxt UI default reads
// differently from the pre-Nuxt design.
//
// app.config overrides are merged by tailwind-variants as the *own* config with
// the packaged theme as `extend`, and tailwind-variants appends the own values
// last (mergeObjects/joinObjects/flatMergeArrays all put `extend` first), so
// tailwind-merge resolves conflicts in favour of what is written here.
export default defineAppConfig({
  ui: {
    // Nuxt UI defaults the semantic hues to green/blue/yellow/red; the pre-Nuxt
    // app used emerald/sky/amber/rose throughout. Setting them here fixes every
    // badge, alert, status rail and stat tile in one place.
    colors: {
      primary: 'violet',
      secondary: 'fuchsia', // only used for the logo gradient's far end
      success: 'emerald',
      info: 'sky',
      warning: 'amber',
      error: 'rose',
      neutral: 'slate',
    },

    card: {
      slots: {
        root: 'rounded-2xl shadow-lg shadow-black/20',
      },
      // The old card was `bg-white/[0.02]` — a hair *lighter* than the page.
      // Nuxt UI's default `outline` variant is the page colour plus a ring,
      // which reads flat; `subtle` is bg-elevated/50 plus a ring.
      defaultVariants: {
        variant: 'subtle',
      },
    },

    button: {
      slots: {
        // Old buttons were rounded-lg; Nuxt UI's base is rounded-md.
        base: 'rounded-lg',
      },
      compoundVariants: [
        // Old solid buttons were the -600 shade with white text
        // (bg-violet-600 hover:bg-violet-500). In dark mode Nuxt UI's
        // `bg-primary` is the -400 shade with dark `text-inverted`, i.e. a pale
        // lavender button with near-black text — a different look entirely.
        //
        // --ui-primary itself is deliberately left at -400, because the
        // `text-primary` accents (links, the Episodes tile, the active nav item)
        // do want the lighter shade, matching the old violet-300/400 accents.
        // Likewise `text-inverted` is left alone: it is what sits on
        // `bg-inverted` (white in dark mode) elsewhere, so retargeting it to
        // white would make a neutral solid button white-on-white.
        {
          color: 'primary',
          variant: 'solid',
          class: 'text-white bg-primary-600 hover:bg-primary-500 active:bg-primary-500 disabled:bg-primary-600 aria-disabled:bg-primary-600',
        },
        {
          color: 'error',
          variant: 'solid',
          class: 'text-white bg-error-600/90 hover:bg-error-500 active:bg-error-500 disabled:bg-error-600/90 aria-disabled:bg-error-600/90',
        },
        {
          color: 'success',
          variant: 'solid',
          class: 'text-white bg-success-600 hover:bg-success-500 active:bg-success-500 disabled:bg-success-600 aria-disabled:bg-success-600',
        },
        {
          color: 'info',
          variant: 'solid',
          class: 'text-white bg-info-600 hover:bg-info-500 active:bg-info-500 disabled:bg-info-600 aria-disabled:bg-info-600',
        },
        {
          color: 'warning',
          variant: 'solid',
          class: 'text-white bg-warning-600 hover:bg-warning-500 active:bg-warning-500 disabled:bg-warning-600 aria-disabled:bg-warning-600',
        },
      ],
    },

    input: {
      slots: {
        base: 'rounded-lg',
      },
    },

    selectMenu: {
      slots: {
        base: 'rounded-lg',
        content: 'bg-panel rounded-xl',
      },
    },

    // Every badge in the old design was a pill. Radius is set per size rather
    // than on `base` because that is where the packaged theme puts it, and the
    // size variant would otherwise win the tailwind-merge.
    badge: {
      variants: {
        size: {
          xs: { base: 'rounded-full' },
          sm: { base: 'rounded-full' },
          md: { base: 'rounded-full' },
          lg: { base: 'rounded-full' },
          xl: { base: 'rounded-full' },
        },
      },
    },

    // Old modal: rounded-2xl on bg-[#0e1320] behind a bg-black/60 blur.
    modal: {
      slots: {
        content: 'bg-panel rounded-2xl',
      },
      variants: {
        overlay: {
          true: {
            overlay: 'bg-black/60 backdrop-blur-sm',
          },
        },
      },
    },

    slideover: {
      slots: {
        overlay: 'bg-black/60 backdrop-blur-sm',
      },
    },

    dropdownMenu: {
      slots: {
        content: 'bg-panel rounded-xl',
      },
    },

    // Old toggle: a white thumb on a violet-600 (checked) or slate (unchecked)
    // track. Nuxt UI's thumb is bg-default, which in this palette is nearly
    // black.
    switch: {
      slots: {
        thumb: 'bg-white',
      },
      variants: {
        color: {
          primary: {
            base: 'data-[state=checked]:bg-primary-600',
          },
        },
      },
    },
  },
})
