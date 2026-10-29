param([string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcherPath = Join-Path $projectRoot 'scripts\launch.mjs'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Brak launch.mjs.' }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not $Destination) { $Destination = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI World.lnk' }
$resolvedDestination = [System.IO.Path]::GetFullPath($Destination)
if ([System.IO.Path]::GetExtension($resolvedDestination) -ne '.lnk') { throw 'Docelowy plik musi być skrótem .lnk.' }
$scriptDestination = [System.IO.Path]::ChangeExtension($resolvedDestination, '.cmd')
if ((Test-Path -LiteralPath $scriptDestination) -and ((Get-Content -LiteralPath $scriptDestination -Raw) -notmatch 'AI_WORLD_DESKTOP_LAUNCHER')) {
  throw 'Istnieje inny skrypt AI World.cmd. Wybierz inną nazwę przez parametr Destination.'
}
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $resolvedDestination) {
  $existing = $shell.CreateShortcut($resolvedDestination)
  if ($existing.Arguments -notlike '*scripts*launch.mjs*') { throw 'Istnieje inny skrót AI World. Wybierz inną nazwę przez parametr Destination.' }
}
$shortcut = $shell.CreateShortcut($resolvedDestination)
$quotedNode = $nodePath.Replace("'", "''")
$quotedLauncher = $launcherPath.Replace("'", "''")
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -Command "& ''' + $quotedNode + ''' ''' + $quotedLauncher + '''"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'AI World — dom Ultrona i E.D.I.T.H.; lokalna Ollama i trwała pamięć'
$shortcut.WindowStyle = 7
$edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (Test-Path -LiteralPath $edgePath) { $shortcut.IconLocation = "$edgePath,0" }
$shortcut.Save()
Write-Output $resolvedDestination
$batchLauncher = (Join-Path $projectRoot 'Start-AI-World.cmd').Replace('%', '%%')
$batchContent = '@echo off' + "`r`n" + 'rem AI_WORLD_DESKTOP_LAUNCHER' + "`r`n" + '"' + $batchLauncher + '"' + "`r`n"
[System.IO.File]::WriteAllText($scriptDestination, $batchContent, [System.Text.UTF8Encoding]::new($false))
Write-Output $scriptDestination
