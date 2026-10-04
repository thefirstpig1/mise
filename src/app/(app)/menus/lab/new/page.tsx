// The lab writes a draft in a sheet over its list now (Kong 2026-10-04);
// this address stays so old links and bookmarks still land in the right place.
import { redirect } from "next/navigation";

export default function NewDraftPage() {
  redirect("/menus/lab?new=1");
}
