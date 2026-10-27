; The customer confirms the uninstall first. Never taskkill processes by name.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Close CopyPaste and its Chrome file connections before installing. / 安裝前請關閉 CopyPaste 及其 Chrome 檔案連線。" /SD IDOK
      SetErrorLevel 42
      Abort
    ${EndIf}
  !endif
!macroend

; Keep encrypted withdrawal/settlement receipts and their DPAPI key available.
; Only the explicit app-cache option may remove application cache directories.
!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Use CopyPaste's cache cleanup option. Encrypted withdrawal and unsettled receipts must be retained." /SD IDOK
    SetErrorLevel 44
    Quit
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ClearErrors
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --prepare-uninstall' $R0
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "CopyPaste could not prepare removal. No installed files were removed." /SD IDOK
      SetErrorLevel 43
      Abort
    ${EndIf}
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Removal was cancelled or could not finish. Close the running Desktop, then retry. / 已取消或未完成撤權；請關閉正在執行的 Desktop 後重試。" /SD IDOK
      SetErrorLevel 41
      Abort
    ${EndIf}
  ${EndIf}
  ; Current Hosts exit on their owned pause/removal marker. Older or another
  ; installation's processes are never killed; fail without deleting files.
  nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "A CopyPaste process is still running. Close its Chrome file connection or other installation, then retry." /SD IDOK
    SetErrorLevel 42
    Abort
  ${EndIf}
!macroend
