Option Explicit
On Error Resume Next

Dim files, shell, root, logFolder, command, result
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
If Err.Number <> 0 Then WScript.Quit 1

root = files.GetParentFolderName(WScript.ScriptFullName)
logFolder = files.BuildPath(root, "logs")
If Not files.FolderExists(logFolder) Then files.CreateFolder logFolder
If Err.Number <> 0 Then WScript.Quit 1

shell.CurrentDirectory = root
If Err.Number <> 0 Then LogFailure "Nao foi possivel abrir a pasta do bot."
If Not files.FileExists(files.BuildPath(root, "app.js")) Then LogFailure "app.js nao foi encontrado. Mantenha este arquivo na pasta do bot."

command = Chr(34) & shell.ExpandEnvironmentStrings("%ComSpec%") & Chr(34) & " /d /c "
result = shell.Run(command & "where.exe node.exe >nul 2>&1", 0, True)
If Err.Number <> 0 Or result <> 0 Then LogFailure "Node.js nao foi encontrado no PATH. Instale o Node.js 22.12 ou superior."

result = shell.Run(command & "node.exe -e ""const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)"" >nul 2>&1", 0, True)
If Err.Number <> 0 Or result <> 0 Then LogFailure "A versao do Node.js precisa ser 22.12 ou superior."

If Not files.FileExists(files.BuildPath(root, "node_modules\discord.js\package.json")) Then LogFailure "Dependencias ausentes. Execute npm ci na pasta do bot."

' O logger do bot grava em log.txt. O stderr anterior ao logger fica separado.
shell.Run command & "node.exe app.js >nul 2>>logs\inicializador.txt", 0, False
If Err.Number <> 0 Then LogFailure "Nao foi possivel iniciar o processo do bot."
WScript.Quit 0

Sub LogFailure(message)
    Dim log
    Err.Clear
    Set log = files.OpenTextFile(files.BuildPath(logFolder, "log.txt"), 8, True)
    log.WriteLine "[" & Now & "] CRITICAL_ERROR"
    log.WriteLine "Inicializador: " & message
    log.WriteBlankLines 1
    log.Close
    WScript.Quit 1
End Sub
