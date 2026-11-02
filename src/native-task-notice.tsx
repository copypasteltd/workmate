import React from "react";
import { useI18n } from "./ui";
import { NativeTaskNoticeView } from "./native-task-notice-view";

export function NativeTaskNotice({ code }: { code?: string | null }) {
  const { t } = useI18n();
  return <NativeTaskNoticeView code={code} t={t} />;
}
