import { readDirectoryFilters, writeDirectoryFilters } from "./directory";

export type UserResourceSection = "execution" | "content";
export function resourceUser(section: string, search: string) {
  const query = new URLSearchParams(search);
  return ["execution", "content"].includes(section) && query.has("user_id")
    ? query.get("user_id") ?? ""
    : null;
}
export function userResourceLink(section: UserResourceSection, user: string, directorySearch: string) {
  const query = new URLSearchParams({ user_id: user });
  const previous = new URLSearchParams(directorySearch);
  const safe = new URLSearchParams(writeDirectoryFilters("", readDirectoryFilters(directorySearch)));
  if (previous.get("search")) safe.set("search", previous.get("search")!.slice(0, 160));
  if (safe.size) query.set("users_return", safe.toString());
  return "/" + section + "?" + query;
}
export function userResourceReturn(user: string, resourceSearch: string) {
  const raw = new URLSearchParams(resourceSearch).get("users_return") ?? "";
  const previous = new URLSearchParams(raw);
  const safe = new URLSearchParams(writeDirectoryFilters("", readDirectoryFilters(raw)));
  if (previous.get("search")) safe.set("search", previous.get("search")!.slice(0, 160));
  return "/users/" + encodeURIComponent(user) + (safe.size ? "?" + safe : "");
}
