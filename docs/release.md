# Releasing

**After the changeset is complete and committed, bump the version on `main`.** The release pipeline does not run without it.

```bash
npm version patch    # or: npm version minor
```

Say which level you picked and why:

- **`minor`**: users get something new or different, such as a new, renamed, or removed setting, or a noticeable behavior change. An upstream sync that lands features is a minor.
- **`patch`**: fixes, performance, and refactors with no visible change.

Either one bumps `package.json`, runs `tools/sync-version.cjs` to copy the version into `assets/appinfo.json`, commits both, and creates the annotated `v<version>` tag. `npm run patch` and `npm run minor` are aliases.

Sequence: commit the work, bump on `main`, then push the branch and tag when asked. The bump must be on `main` because `update-repo.yml` runs with `ref: 'main'` and commits `repo.json` back there.

## Why the tag is load-bearing

- `release.yml` triggers on `v*.*` tags only. It checks the tag against `package.json` and fails loudly on a mismatch.
- Webpack copies `assets/**/*` into `dist/`, so `assets/appinfo.json` is what `ares-package` names the `.ipk` from.
- `release.yml` dispatches `update-repo.yml`, which regenerates `repo.json` from `appinfo.json` plus the latest `.ipk` and commits it to `main`. The dispatch is required, because releases created with the default `GITHUB_TOKEN` never fire `release: published`.

Without the guard, a hand-made tag would publish a `v0.2.1` release containing a `0.2.0` package, with `repo.json` advertising `0.2.0`. That failure is silent and reaches users.

## Where the package lands

`npm run package` runs `ares-package -n dist -o dist`, which writes the `.ipk` into `dist/`. `test.yml` and `release.yml` upload `dist/*.ipk`, and `tools/deploy.js` installs from the same path. Moving it means updating all three in the same commit.
