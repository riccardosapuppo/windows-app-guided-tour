<#
    The one place this project touches Windows.

    Everything the tour needs to know about another application comes through
    here: which windows exist, where a control is on the screen, what is in it,
    and — when the tour is asked to do a step rather than explain it — pressing
    it.

    It speaks JSON on standard output, one command per run. That is deliberate.
    A long-lived helper holding a connection to the accessibility tree is faster
    and has to be supervised, restarted and reasoned about; a command that runs,
    answers and exits cannot leak a handle, cannot wedge, and can be run by hand
    from a terminal when somebody is trying to work out why a step will not
    match. The tour asks a few times a second at most.

    It uses UI AUTOMATION rather than screen coordinates or image matching, and
    that is the difference between this and most overlay tutorials:

      - A control is found by its automation id, which does not move when the
        window is resized, the theme changes, or the display is scaled.
      - A button is pressed with InvokePattern, the way a screen reader presses
        it. Not by moving the mouse there and clicking — which presses whatever
        is under that point at that instant, and moving the mouse mid-step is
        something people do.
      - What a step is waiting for is READ from the control rather than assumed
        from having sent a click.

    Nothing here writes to a file, opens a network connection, or takes a
    screenshot. It reads the accessibility tree of a window on the same desktop
    and, on request, invokes a control. That is the whole surface.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('windows', 'find', 'describe', 'invoke', 'value', 'focus', 'type')]
    [string] $Command,

    # Which window to look in. Matched on its title, as a substring, because a
    # title routinely carries a document name that changes.
    [string] $Window = '',

    # The automation id of a control. Stable across resizes and themes, which a
    # name is not: a name is what the label says, and labels get translated.
    [string] $Id = '',

    # A name to match when a control has no automation id. Many applications
    # set neither; those are the ones a tour cannot be written for, and saying
    # so is better than matching on a coordinate.
    [string] $Name = '',

    # What to put in a control. Only used by `type`, and only by the check that
    # plays the part of the person: the tour itself deliberately does not type
    # for anybody — see `whyNot` on that step in tours/stock-control.json.
    [string] $Text = '',

    [int] $TimeoutMs = 4000
)

$ErrorActionPreference = 'Stop'

function Answer($object) {
    # Depth matters: a rectangle is nested, and the default of 2 would flatten
    # it to the type name.
    $object | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

function Refuse($why, $detail = $null) {
    Answer @{ ok = $false; why = $why; detail = $detail }
}

try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
} catch {
    Refuse 'this needs UI Automation, which is part of .NET on Windows' $_.Exception.Message
}

$root = [System.Windows.Automation.AutomationElement]::RootElement

function Rect($element) {
    $r = $element.Current.BoundingRectangle

    # An element that is scrolled out of view, collapsed, or in a tab that is
    # not showing has an empty rectangle. It exists and it is not on the screen,
    # and the tour has to be able to tell those apart — a hole cut around
    # nothing is worse than no hole.
    if ($r.IsEmpty -or [double]::IsInfinity($r.Left)) { return $null }

    @{
        x      = [int][Math]::Round($r.Left)
        y      = [int][Math]::Round($r.Top)
        width  = [int][Math]::Round($r.Width)
        height = [int][Math]::Round($r.Height)
    }
}

function Describe($element) {
    @{
        id       = $element.Current.AutomationId
        name     = $element.Current.Name
        type     = $element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        enabled  = $element.Current.IsEnabled
        offscreen = $element.Current.IsOffscreen
        rect     = Rect $element
        patterns = @($element.GetSupportedPatterns() | ForEach-Object {
            $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', ''
        })
    }
}

function FindWindow($title) {
    if (-not $title) { Refuse 'no window was named' }

    # By substring rather than exactly. A window is called "Stock control —
    # order 4471" while somebody is working, and a tour written against the
    # exact title stops matching the moment they open anything.
    $windows = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Window))
    )

    foreach ($w in $windows) {
        if ($w.Current.Name -like "*$title*") { return $w }
    }

    return $null
}

function FindIn($window, $id, $name) {
    if ($id) {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    } elseif ($name) {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    } else {
        Refuse 'a control needs an id or a name'
    }

    # Waited for rather than asked once. A control that is about to appear —
    # a dialog opening, a tab being drawn — is not there for the first few
    # hundred milliseconds, and asking once makes a tour that works when the
    # machine is fast.
    $until = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)

    do {
        $found = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($found) { return $found }
        Start-Sleep -Milliseconds 120
    } while ([DateTime]::UtcNow -lt $until)

    return $null
}

switch ($Command) {

    'windows' {
        $found = @()
        $all = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Window))
        )

        foreach ($w in $all) {
            if (-not $w.Current.Name) { continue }
            $found += @{ title = $w.Current.Name; class = $w.Current.ClassName; rect = Rect $w }
        }

        Answer @{ ok = $true; windows = $found }
    }

    'find' {
        # NOT `$window`. `$Window` is a [string] parameter, PowerShell is
        # case-insensitive, and a variable declared with a type keeps that
        # constraint for the rest of the script — so assigning an
        # AutomationElement to `$window` silently coerces it to its type name.
        # The failure is `[System.String] does not contain a method named
        # 'FindFirst'`, a hundred lines away from the assignment.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        $element = FindIn $inside $Id $Name
        if (-not $element) { Refuse "nothing in that window with id '$Id' or name '$Name'" }

        Answer @{ ok = $true; window = $inside.Current.Name; element = Describe $element }
    }

    'describe' {
        # NOT `$window`. `$Window` is a [string] parameter, PowerShell is
        # case-insensitive, and a variable declared with a type keeps that
        # constraint for the rest of the script — so assigning an
        # AutomationElement to `$window` silently coerces it to its type name.
        # The failure is `[System.String] does not contain a method named
        # 'FindFirst'`, a hundred lines away from the assignment.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        $all = $inside.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)

        $elements = @()
        foreach ($e in $all) { $elements += Describe $e }

        # Everything, so somebody writing a tour can see what there is to point
        # at. This is the command run by hand when a step will not match.
        Answer @{ ok = $true; window = $inside.Current.Name; rect = Rect $inside; elements = $elements }
    }

    'invoke' {
        # NOT `$window`. `$Window` is a [string] parameter, PowerShell is
        # case-insensitive, and a variable declared with a type keeps that
        # constraint for the rest of the script — so assigning an
        # AutomationElement to `$window` silently coerces it to its type name.
        # The failure is `[System.String] does not contain a method named
        # 'FindFirst'`, a hundred lines away from the assignment.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        $element = FindIn $inside $Id $Name
        if (-not $element) { Refuse "nothing in that window with id '$Id' or name '$Name'" }

        if (-not $element.Current.IsEnabled) { Refuse 'that control is disabled' }

        # Invoke, not a mouse click. A click presses whatever is under a point
        # at the instant it lands, and people move the mouse; Invoke presses the
        # control, and works when the window is behind something.
        try {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
            Answer @{ ok = $true; did = 'invoked'; element = Describe $element }
        } catch {
            # Not everything is invokable. A checkbox toggles, a list item is
            # selected. Saying which pattern is missing is more use than "could
            # not click".
            Refuse 'that control does not support being invoked' (Describe $element).patterns
        }
    }

    'value' {
        # NOT `$window`. `$Window` is a [string] parameter, PowerShell is
        # case-insensitive, and a variable declared with a type keeps that
        # constraint for the rest of the script — so assigning an
        # AutomationElement to `$window` silently coerces it to its type name.
        # The failure is `[System.String] does not contain a method named
        # 'FindFirst'`, a hundred lines away from the assignment.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        $element = FindIn $inside $Id $Name
        if (-not $element) { Refuse "nothing in that window with id '$Id' or name '$Name'" }

        try {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            Answer @{ ok = $true; value = $pattern.Current.Value; element = Describe $element }
        } catch {
            # Fall back to the name, which for a label or a button IS its text.
            Answer @{ ok = $true; value = $element.Current.Name; from = 'the name, since it has no value'; element = Describe $element }
        }
    }

    'type' {
        # NOT keystrokes. `SendKeys` puts characters wherever the focus happens
        # to be at that instant, and focus moves — a notification, somebody
        # alt-tabbing, the application itself. ValuePattern sets the value of
        # the control that was asked for, and of no other.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        $element = FindIn $inside $Id $Name
        if (-not $element) { Refuse "nothing in that window with id '$Id' or name '$Name'" }

        try {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($pattern.Current.IsReadOnly) { Refuse 'that control is read-only' }
            $pattern.SetValue($Text)
            Answer @{ ok = $true; did = 'typed'; value = $pattern.Current.Value }
        } catch {
            Refuse 'that control does not take a value' (Describe $element).patterns
        }
    }

    'focus' {
        # NOT `$window`. `$Window` is a [string] parameter, PowerShell is
        # case-insensitive, and a variable declared with a type keeps that
        # constraint for the rest of the script — so assigning an
        # AutomationElement to `$window` silently coerces it to its type name.
        # The failure is `[System.String] does not contain a method named
        # 'FindFirst'`, a hundred lines away from the assignment.
        $inside = FindWindow $Window
        if (-not $inside) { Refuse "no window whose title contains '$Window'" }

        try {
            $inside.SetFocus()
            Answer @{ ok = $true; did = 'focused'; window = $inside.Current.Name }
        } catch {
            Refuse 'that window would not take focus' $_.Exception.Message
        }
    }
}
