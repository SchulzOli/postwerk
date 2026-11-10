# MarketingApp4BusinessCentral

An extension for Microsoft Dynamics 365 Business Central that connects a company to a MarketingAsAService workspace: campaigns, letters by post to a segment, and sales back into the campaign's results.

**Status: defined, not built yet.** The app has its setup page and nothing else. What it will do, how it talks to the server and the build order are in [docs/business-central.md](../../docs/business-central.md).

## Layout

```
app.json           The app: name, version, object numbers (50100–50199), Business Central version (26+)
src/               One object per file, in a folder per area: MaaSSetup.Table.al
Translations/      German texts (…de-DE.xlf); the compiler writes the English …g.xlf
scripts/build.sh   Compiles the app and checks the translation, as CI does
mockups/           The planned screens as HTML, for the pictures in the docs
```

This is an AL project, not an npm workspace: `npm run build` and `npm test` at the repository's root leave it alone.

## Develop

1. Open this folder in VS Code with the [AL Language extension](https://marketplace.visualstudio.com/items?itemName=ms-dynamics-smb.al).
2. **AL: Download symbols** from a Business Central sandbox (this creates your own `.vscode/launch.json`, which is not committed).
3. Publish with F5 and search for **MarketingAsAService Setup**.

## Check

CI compiles the app against Business Central 26 with CodeCop, UICop and PerTenantExtensionCop and checks the German translation (`.github/workflows/business-central.yml`). The same on your machine, with Node 22+ and the .NET SDK 8 or later:

```bash
dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease
scripts/build.sh
```

## Mockups

`mockups/` holds the planned screens as plain HTML with one stylesheet. They are drawings of the definition, not captures from Business Central, and each one says so in its corner. To change a picture in the docs, edit the page, open it in a browser at 1280 × 800 and save a capture as `docs/screenshots/business-central-<page>.png`. Replace a mockup with a real capture once its screen is built.

## Conventions

- Object names start with `MaaS`; numbers come from `idRanges` in `app.json`.
- Texts people see are English in the source (`Caption`, `ToolTip`, labels) and German ("du") in `Translations/MarketingApp4BusinessCentral.de-DE.xlf`. After a compile, copy new texts from the `.g.xlf` and add a `<target>`.
- Secrets are `SecretText` in isolated storage, never a table field, a message or telemetry.
- The app only calls the server's `/api/v1`. Marketing rules (formats, limits, approval) stay on the server.
- Every new object goes into a permission set in `src/Permissions`.
