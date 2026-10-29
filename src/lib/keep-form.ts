// ============================================================
// คิดครัว — a refused form keeps what the person typed (Kong 2026-10-30)
// ============================================================
// React 19 resets a <form action={fn}> after EVERY submission — refused ones
// included. Setting up a shop from scratch, one missing VAT rate on the
// supplier form wiped the name and phone typed above it, and the person had to
// type them again without being told why they vanished.
//
// Submitting through onSubmit instead keeps the form exactly as typed when the
// action answers ok:false. On ok:true the form is reset as React did before, so
// "บันทึกแล้วเพิ่มอีก" still starts empty. `isPending` keeps working because
// the dispatch runs inside a transition, which is what useActionState counts.
//
// Spread the result onto the form: <form {...keep}>. `action` stays on the
// tag on purpose — before the page has hydrated (a slow phone) the browser
// still posts to the server action as before, instead of a bare GET that would
// put every typed field into the URL. After hydration onSubmit prevents that
// default, and React then runs no form action of its own and resets nothing.
// ============================================================

import { startTransition, useEffect, useRef, type FormEvent, type RefObject } from "react";

export function useKeepForm<S extends { ok: boolean } | null | undefined>(
  dispatch: (fd: FormData) => void,
  state: S,
  ref?: RefObject<HTMLFormElement | null>
) {
  const own = useRef<HTMLFormElement | null>(null);
  const form = ref ?? own;
  const seen = useRef(state);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state?.ok) form.current?.reset();
  }, [state, form]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // The button that was pressed rides along, as it would with action={}.
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(fd));
  };

  return { ref: form, action: dispatch, onSubmit };
}
