#!/usr/bin/env bash
# Compiles the app the way CI does: downloads Microsoft's symbols for the
# Business Central version in app.json, compiles with the code analyzers and
# checks the German translation.
#
# Needs Node 22+, the .NET SDK (8 or later) and the AL tool:
#   dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease
set -euo pipefail
cd "$(dirname "$0")/.."

al downloadsymbols --project . --packagecachepath .alpackages --globalsourcesonly --enforceminorversion --raw
ls .alpackages/*.app > /dev/null

# The analyzers ship with the tool, once per .NET version.
framework=net8.0
if [ "$(dotnet --version | cut -d. -f1)" -ge 10 ]; then framework=net10.0; fi
analyzers=$(find "$(dirname "$(command -v al)")/.store" -type d -path "*/tools/$framework/any" | head -n 1)

rm -f ./*.app
al compile /project:. /packagecachepath:.alpackages /outfolder:. \
  "/analyzer:$analyzers/Microsoft.Dynamics.Nav.CodeCop.dll,$analyzers/Microsoft.Dynamics.Nav.UICop.dll,$analyzers/Microsoft.Dynamics.Nav.PerTenantExtensionCop.dll"
ls ./*.app

node scripts/check-translations.mjs
