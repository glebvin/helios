# Existing tooling issue

`corepack pnpm --filter @helios/domain exec tsc --noEmit` cannot resolve types/node (TS2688) because the domain package has no local @types/node resolution in the installed layout. No dependency/config/domain source changes were made. The existing installed types are usable with `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types`, measured exit0. Domain runtime10 and API51 pass. Independent verification should preserve this explicit distinction.
