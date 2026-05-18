# setup-scheduled-task.ps1
# Registers a Windows Task Scheduler task that runs "npm run check:new" every day.
# Run once as Administrator (or in a session with task-creation rights).

$TaskName  = "GreekLegislationDailyCheck"
$ProjectDir = $PSScriptRoot  # folder where this script lives

# Resolve npm executable (works with both plain npm and nvm-managed installs)
$NpmPath = (Get-Command npm -ErrorAction Stop).Source

# The action: npm run check:new inside the project directory
$Action = New-ScheduledTaskAction `
    -Execute    $NpmPath `
    -Argument   "run check:new" `
    -WorkingDirectory $ProjectDir

# Trigger: every day at 08:00 (change the time below if desired)
$Trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

# Run whether or not the user is logged in; do not store password
$Principal = New-ScheduledTaskPrincipal `
    -UserId    "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType  Interactive `
    -RunLevel   Highest

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable    # run as soon as possible if a scheduled start was missed

# Remove existing task with the same name if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'."
}

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Principal $Principal `
    -Settings  $Settings `
    -Description "Daily check for new Greek legislation PDFs on search.et.gr"

Write-Host ""
Write-Host "Scheduled task '$TaskName' created successfully."
Write-Host "It will run every day at 08:00 and download any new PDFs to:"
Write-Host "  $ProjectDir\downloads\<year>\"
Write-Host ""
Write-Host "To run it immediately:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To remove the task:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
