Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "CopyPaste isolated removal verification"
OutFile "D:\dev\copypasted\自有agent\dev\copypaste-delivery\.data\nsis-removal-117\f72272f9-bddb-4fa3-8516-3f56ed9ae42c\remove-check.exe"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!addplugindir /x86-unicode "C:\Users\carzy\AppData\Local\electron-builder\Cache\nsis\nsis-resources-3.4.1\plugins\x86-unicode"
!define APP_EXECUTABLE_FILENAME "CopyPaste-RemovalFixture-84e99d4e37714aa38d76fe03e6fcedee.exe"
!define BUILD_UNINSTALLER
Var UpdatedFlag
!define isUpdated '$UpdatedFlag == "1"'
!include "D:\dev\copypasted\自有agent\dev\copypaste-desktop\scripts\desktop-lifecycle.nsh"
Function .onInit
 StrCpy $INSTDIR "D:\dev\copypasted\自有agent\dev\copypaste-delivery\.data\nsis-removal-117\f72272f9-bddb-4fa3-8516-3f56ed9ae42c"
 StrCpy $UpdatedFlag "0"
 ${GetParameters} $R0
 ClearErrors
 ${GetOptions} $R0 "--updated" $R1
 ${IfNot} ${Errors}
  StrCpy $UpdatedFlag "1"
 ${EndIf}
 ClearErrors
 !insertmacro customUnInit
FunctionEnd
Section "Owned verification only"
 !insertmacro customUnInstall
 FileOpen $R2 "$INSTDIR\removal-boundary.txt" w
 FileWrite $R2 "hook completed"
 FileClose $R2
SectionEnd
