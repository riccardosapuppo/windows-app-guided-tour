<#
    An invented desktop application, so the tour has something to teach.

    Everything in it is made up: the company, the parts, the customers, the
    numbers. It exists because a guided tour with nothing to guide is a
    screenshot, and because anybody who clones this should be able to watch the
    overlay work within a minute of `npm install` — with no licence, no second
    machine, and nothing installed beyond what Windows already has.

    It is WPF rather than WinForms, and that is not a matter of taste. WPF is a
    native UI Automation provider: every control comes out of the accessibility
    tree with its real type, its automation id, its screen rectangle, and the
    patterns it supports — Invoke on a button, Value on a text box. WinForms
    exposes the older MSAA interface, and through the bridge the same controls
    arrive as untyped panes with no patterns at all, which is enough to draw a
    box around and not enough to press or to read.

    Written in XAML inside PowerShell so it needs no compiler, no project file
    and no build step. `Add-Type -AssemblyName PresentationFramework` is on
    every Windows machine.

    **Every control that a tour points at carries an AutomationId.** That is the
    whole contract between an application and anything that automates it: an id
    does not move when the window is resized, does not change when the theme
    does, and is not translated. A tour written against a label's text is a tour
    that breaks the first time somebody rewords a button.
#>

param(
    [int] $Width = 940,
    [int] $Height = 620
)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

[xml] $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Stock control"
        Width="940" Height="620"
        WindowStartupLocation="CenterScreen"
        Background="#F3F5F7"
        FontFamily="Segoe UI" FontSize="13">

  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Padding" Value="14,7"/>
      <Setter Property="Margin" Value="0,0,8,0"/>
      <Setter Property="MinWidth" Value="110"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Padding" Value="6,4"/>
      <Setter Property="Margin" Value="0,0,0,10"/>
    </Style>
    <Style TargetType="TextBlock" x:Key="Label">
      <Setter Property="Foreground" Value="#5A6672"/>
      <Setter Property="FontSize" Value="11"/>
      <Setter Property="Margin" Value="0,0,0,3"/>
    </Style>
  </Window.Resources>

  <DockPanel>

    <!-- The toolbar. The first thing a tour points at, and the thing every
         desktop application has. -->
    <Border DockPanel.Dock="Top" Background="#FFFFFF" BorderBrush="#DDE2E6" BorderThickness="0,0,0,1" Padding="14,10">
      <StackPanel Orientation="Horizontal">
        <Button x:Name="newOrder" AutomationProperties.AutomationId="newOrder" Content="New order"/>
        <Button x:Name="findPart" AutomationProperties.AutomationId="findPart" Content="Find a part"/>
        <Button x:Name="receiveStock" AutomationProperties.AutomationId="receiveStock" Content="Receive stock"/>
        <Button x:Name="printLabels" AutomationProperties.AutomationId="printLabels" Content="Print labels" IsEnabled="False"/>
      </StackPanel>
    </Border>

    <!-- The status line. What the tour reads to know a step is done: not "I
         sent a click", but "the application says it happened". -->
    <Border DockPanel.Dock="Bottom" Background="#FFFFFF" BorderBrush="#DDE2E6" BorderThickness="0,1,0,0" Padding="14,7">
      <!-- No AutomationProperties.Name here, on purpose.

           A TextBlock has no value; UI Automation exposes its TEXT as its
           name, which is what a screen reader reads out and what anything
           watching this line has to read. Setting a name replaces that with
           the label — so the status line reported "What the application last
           did" for ever, whatever it said, and three steps of the tour waited
           on a phrase that could never arrive.

           The label belongs in the AutomationId, which is what it is for. -->
      <TextBlock x:Name="status"
                 AutomationProperties.AutomationId="status"
                 Text="Ready. Everything in this window is invented."
                 Foreground="#5A6672"/>
    </Border>

    <Grid Margin="14">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="330"/>
        <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>

      <!-- The form. -->
      <Border Grid.Column="0" Background="#FFFFFF" BorderBrush="#DDE2E6" BorderThickness="1" CornerRadius="8"
              Padding="16" Margin="0,0,12,0" VerticalAlignment="Top">
        <StackPanel>
          <TextBlock Text="THE ORDER" FontWeight="SemiBold" FontSize="11" Foreground="#8A949E" Margin="0,0,0,12"/>

          <TextBlock Text="Customer" Style="{StaticResource Label}"/>
          <TextBox x:Name="customer"
                   AutomationProperties.AutomationId="customer"
                   AutomationProperties.Name="Customer"/>

          <TextBlock Text="Part number" Style="{StaticResource Label}"/>
          <TextBox x:Name="partNumber"
                   AutomationProperties.AutomationId="partNumber"
                   AutomationProperties.Name="Part number"/>

          <TextBlock Text="How many" Style="{StaticResource Label}"/>
          <TextBox x:Name="quantity"
                   AutomationProperties.AutomationId="quantity"
                   AutomationProperties.Name="How many"
                   Text="1"/>

          <StackPanel Orientation="Horizontal" Margin="0,8,0,0">
            <Button x:Name="addLine" AutomationProperties.AutomationId="addLine" Content="Add the line"/>
            <Button x:Name="clearForm" AutomationProperties.AutomationId="clearForm" Content="Clear"/>
          </StackPanel>
        </StackPanel>
      </Border>

      <!-- The lines, and the thing that finishes the job. -->
      <Border Grid.Column="1" Background="#FFFFFF" BorderBrush="#DDE2E6" BorderThickness="1" CornerRadius="8" Padding="16">
        <DockPanel>
          <TextBlock DockPanel.Dock="Top" Text="LINES ON THIS ORDER" FontWeight="SemiBold" FontSize="11"
                     Foreground="#8A949E" Margin="0,0,0,10"/>

          <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" Margin="0,12,0,0">
            <Button x:Name="saveOrder"
                    AutomationProperties.AutomationId="saveOrder"
                    Content="Save the order" IsEnabled="False"
                    Background="#2F5D8A" Foreground="White" BorderBrush="#2F5D8A"/>
            <TextBlock x:Name="total"
                       AutomationProperties.AutomationId="total"
                       Text="No lines yet" VerticalAlignment="Center" Margin="10,0,0,0" Foreground="#5A6672"/>
          </StackPanel>

          <ListBox x:Name="lines"
                   AutomationProperties.AutomationId="lines"
                   AutomationProperties.Name="Lines on this order"
                   BorderBrush="#E8ECEF" BorderThickness="1"/>
        </DockPanel>
      </Border>
    </Grid>
  </DockPanel>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$find = { param($name) $window.FindName($name) }

$customer   = & $find 'customer'
$partNumber = & $find 'partNumber'
$quantity   = & $find 'quantity'
$lines      = & $find 'lines'
$total      = & $find 'total'
$status     = & $find 'status'
$saveOrder  = & $find 'saveOrder'
$printLabels = & $find 'printLabels'

function Say($text) {
    $status.Text = $text
}

(& $find 'newOrder').Add_Click({
    $customer.Text = ''
    $partNumber.Text = ''
    $quantity.Text = '1'
    $lines.Items.Clear()
    $total.Text = 'No lines yet'
    $saveOrder.IsEnabled = $false
    $printLabels.IsEnabled = $false
    Say 'A new order. Nothing on it yet.'
    $customer.Focus() | Out-Null
})

(& $find 'findPart').Add_Click({
    # Invented, and deliberately not a dialog: a modal window is a second
    # accessibility tree and a second thing for a tour to find, which is worth
    # showing somewhere but not in the first three steps.
    $partNumber.Text = 'NB-4471'
    Say 'Found one part matching. Its number is in the form.'
})

(& $find 'receiveStock').Add_Click({
    Say 'Nothing to receive today.'
})

(& $find 'clearForm').Add_Click({
    $customer.Text = ''
    $partNumber.Text = ''
    $quantity.Text = '1'
    Say 'The form is empty again.'
})

(& $find 'addLine').Add_Click({
    if (-not $customer.Text) { Say 'A line needs a customer.'; return }
    if (-not $partNumber.Text) { Say 'A line needs a part number.'; return }

    $count = 0
    if (-not [int]::TryParse($quantity.Text, [ref] $count) -or $count -lt 1) {
        Say 'How many has to be a number, at least one.'
        return
    }

    $lines.Items.Add("$count x $($partNumber.Text) for $($customer.Text)") | Out-Null
    $total.Text = "$($lines.Items.Count) line(s)"
    $saveOrder.IsEnabled = $true

    $partNumber.Text = ''
    $quantity.Text = '1'
    Say "Added. The order has $($lines.Items.Count) line(s)."
})

$saveOrder.Add_Click({
    $reference = 'SO-' + (Get-Random -Minimum 10000 -Maximum 99999)
    Say "Saved as $reference. You can print the labels now."
    $printLabels.IsEnabled = $true
    $saveOrder.IsEnabled = $false
})

$printLabels.Add_Click({
    Say 'Labels sent to the printer. Nothing was really printed.'
})

$window.ShowDialog() | Out-Null
