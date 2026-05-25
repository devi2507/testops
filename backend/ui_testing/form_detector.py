"""
Form detection and auto-fill module.
Uses Playwright to discover all <form> elements on a page,
identifies field types, and fills them with realistic fake data via Faker.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from faker import Faker

logger = logging.getLogger("ui_testing.form_detector")
fake = Faker()


@dataclass
class FormField:
    """Represents a single form field discovered on the page."""
    selector: str
    tag: str             # input, textarea, select
    field_type: str      # text, email, password, tel, url, etc.
    name: str
    label: str
    value_filled: str = ""
    filled: bool = False


@dataclass
class DetectedForm:
    """Represents a single detected form element and its fields."""
    form_index: int
    action: str
    method: str
    fields: list[FormField] = field(default_factory=list)
    submitted: bool = False
    submit_result: str = ""  # "success", "error", "redirect", "no_change"
    redirect_url: str = ""
    screenshot_after: str = ""


# Map common field name patterns to faker generators
FIELD_GENERATORS = {
    "email":     lambda: fake.email(),
    "mail":      lambda: fake.email(),
    "e-mail":    lambda: fake.email(),
    "password":  lambda: "TestPass123!",
    "pass":      lambda: "TestPass123!",
    "pwd":       lambda: "TestPass123!",
    "phone":     lambda: fake.phone_number(),
    "tel":       lambda: fake.phone_number(),
    "mobile":    lambda: fake.phone_number(),
    "name":      lambda: fake.name(),
    "fullname":  lambda: fake.name(),
    "full_name": lambda: fake.name(),
    "firstname": lambda: fake.first_name(),
    "first_name":lambda: fake.first_name(),
    "fname":     lambda: fake.first_name(),
    "lastname":  lambda: fake.last_name(),
    "last_name": lambda: fake.last_name(),
    "lname":     lambda: fake.last_name(),
    "company":   lambda: fake.company(),
    "org":       lambda: fake.company(),
    "address":   lambda: fake.street_address(),
    "street":    lambda: fake.street_address(),
    "city":      lambda: fake.city(),
    "state":     lambda: fake.state(),
    "zip":       lambda: fake.zipcode(),
    "zipcode":   lambda: fake.zipcode(),
    "postal":    lambda: fake.zipcode(),
    "country":   lambda: fake.country(),
    "url":       lambda: "https://testops-audit.local",
    "website":   lambda: "https://testops-audit.local",
    "message":   lambda: fake.paragraph(nb_sentences=2),
    "comment":   lambda: fake.paragraph(nb_sentences=2),
    "subject":   lambda: fake.sentence(nb_words=5),
    "title":     lambda: fake.sentence(nb_words=4),
    "username":  lambda: fake.user_name(),
    "user":      lambda: fake.user_name(),
    "age":       lambda: str(fake.random_int(min=18, max=65)),
    "dob":       lambda: fake.date_of_birth(minimum_age=18, maximum_age=65).strftime("%Y-%m-%d"),
    "date":      lambda: fake.date_this_year().strftime("%Y-%m-%d"),
}

# Map input type= attributes to generators
TYPE_GENERATORS = {
    "email":    lambda: fake.email(),
    "password": lambda: "TestPass123!",
    "tel":      lambda: fake.phone_number(),
    "url":      lambda: "https://testops-audit.local",
    "number":   lambda: str(fake.random_int(min=1, max=100)),
    "date":     lambda: fake.date_this_year().strftime("%Y-%m-%d"),
    "text":     lambda: fake.sentence(nb_words=3),
}


def _pick_generator(field_type: str, field_name: str) -> str:
    """Choose the best faker value for a given field type and name."""
    name_lower = field_name.lower().replace("-", "").replace("_", "")

    # Try matching the field name first (more specific)
    for key, gen in FIELD_GENERATORS.items():
        if key.replace("_", "") in name_lower:
            return gen()

    # Fall back to input type
    if field_type in TYPE_GENERATORS:
        return TYPE_GENERATORS[field_type]()

    # Default
    return fake.sentence(nb_words=3)


class FormDetector:
    """Detects and auto-fills all forms on a page using Playwright + Faker."""

    def __init__(self, page):
        self.page = page

    async def detect_forms(self) -> list[DetectedForm]:
        """Find all <form> elements and map their fields."""
        forms = []
        try:
            form_elements = await self.page.query_selector_all("form")
            logger.info(f"Found {len(form_elements)} form(s) on page")

            for idx, form_el in enumerate(form_elements):
                try:
                    action = await self.page.evaluate(
                        "el => el.getAttribute('action') || ''", form_el
                    ) or ""
                    method = await self.page.evaluate(
                        "el => (el.getAttribute('method') || 'GET').toUpperCase()", form_el
                    ) or "GET"

                    detected = DetectedForm(
                        form_index=idx,
                        action=action,
                        method=method,
                    )

                    # Find all input fields within this form
                    field_selectors = [
                        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
                        "textarea",
                        "select",
                    ]
                    for sel in field_selectors:
                        elements = await form_el.query_selector_all(sel)
                        for el in elements:
                            try:
                                if not await el.is_visible():
                                    continue
                                if await el.is_disabled():
                                    continue

                                tag = await self.page.evaluate("el => el.tagName.toLowerCase()", el)
                                ftype = await self.page.evaluate(
                                    "el => el.getAttribute('type') || 'text'", el
                                ) or "text"
                                fname = await self.page.evaluate(
                                    "el => el.getAttribute('name') || el.getAttribute('id') || ''", el
                                ) or ""
                                flabel = await self.page.evaluate("""el => {
                                    const id = el.getAttribute('id');
                                    if (id) {
                                        const lbl = document.querySelector(`label[for="${id}"]`);
                                        if (lbl) return lbl.textContent.trim();
                                    }
                                    const parent = el.closest('label');
                                    if (parent) return parent.textContent.trim();
                                    const placeholder = el.getAttribute('placeholder');
                                    if (placeholder) return placeholder;
                                    return '';
                                }""", el)

                                field_obj = FormField(
                                    selector=f"form:nth-of-type({idx + 1}) {sel}",
                                    tag=tag,
                                    field_type=ftype if tag == "input" else tag,
                                    name=fname,
                                    label=flabel or fname,
                                )
                                detected.fields.append(field_obj)
                            except Exception:
                                continue

                    forms.append(detected)
                except Exception as e:
                    logger.warning(f"Error processing form {idx}: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error detecting forms: {e}")

        return forms

    async def fill_form(self, form: DetectedForm) -> DetectedForm:
        """Fill all fields in a detected form with realistic fake data."""
        form_selector = f"form:nth-of-type({form.form_index + 1})"
        form_el = await self.page.query_selector(form_selector)
        if not form_el:
            # Fallback: try all forms
            all_forms = await self.page.query_selector_all("form")
            if form.form_index < len(all_forms):
                form_el = all_forms[form.form_index]
            else:
                logger.warning(f"Could not re-locate form {form.form_index}")
                return form

        for f in form.fields:
            try:
                value = _pick_generator(f.field_type, f.name)
                # Get the actual element within the form
                selectors_to_try = []
                if f.name:
                    selectors_to_try.append(f'[name="{f.name}"]')
                    selectors_to_try.append(f'#{f.name}')

                el = None
                for s in selectors_to_try:
                    el = await form_el.query_selector(s)
                    if el:
                        break

                if not el:
                    # Fallback: try by type within the form
                    if f.tag == "textarea":
                        el = await form_el.query_selector("textarea")
                    elif f.tag == "select":
                        el = await form_el.query_selector("select")

                if el and await el.is_visible():
                    if f.tag == "select":
                        # Select the second option if available (first is often placeholder)
                        options = await el.query_selector_all("option")
                        if len(options) > 1:
                            opt_value = await self.page.evaluate(
                                "el => el.value", options[1]
                            )
                            await el.select_option(opt_value)
                            f.value_filled = opt_value
                        elif options:
                            opt_value = await self.page.evaluate(
                                "el => el.value", options[0]
                            )
                            await el.select_option(opt_value)
                            f.value_filled = opt_value
                    elif f.field_type in ("checkbox", "radio"):
                        if not await el.is_checked():
                            await el.check(timeout=2000)
                        f.value_filled = "checked"
                    else:
                        await el.fill(value, timeout=2000)
                        f.value_filled = value

                    f.filled = True
                    logger.debug(f"Filled [{f.field_type}] '{f.name}' with '{f.value_filled[:30]}'")

            except Exception as e:
                logger.warning(f"Could not fill field '{f.name}': {e}")
                continue

        return form

    async def submit_form(self, form: DetectedForm) -> DetectedForm:
        """Submit a form and record what happened."""
        form_selector = f"form:nth-of-type({form.form_index + 1})"
        form_el = await self.page.query_selector(form_selector)
        if not form_el:
            all_forms = await self.page.query_selector_all("form")
            if form.form_index < len(all_forms):
                form_el = all_forms[form.form_index]

        if not form_el:
            form.submit_result = "error"
            return form

        url_before = self.page.url

        try:
            # Try clicking submit button first
            submit_btn = await form_el.query_selector(
                "button[type='submit'], input[type='submit'], button:not([type])"
            )
            if submit_btn and await submit_btn.is_visible():
                await submit_btn.click(timeout=5000)
            else:
                # Fallback: submit via JS
                await self.page.evaluate("el => el.submit()", form_el)

            # Wait for navigation or network activity
            try:
                await self.page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                await asyncio.sleep(1)

            url_after = self.page.url
            if url_after != url_before:
                form.submit_result = "redirect"
                form.redirect_url = url_after
            else:
                # Check for success/error messages on the page
                page_text = await self.page.text_content("body") or ""
                page_lower = page_text.lower()
                if any(w in page_lower for w in ("thank", "success", "submitted", "received")):
                    form.submit_result = "success"
                elif any(w in page_lower for w in ("error", "invalid", "required", "failed")):
                    form.submit_result = "error"
                else:
                    form.submit_result = "no_change"

            form.submitted = True

        except Exception as e:
            form.submit_result = f"error: {str(e)[:100]}"
            form.submitted = True
            logger.warning(f"Form submit failed: {e}")

        return form

    async def detect_fill_and_submit(self) -> list[DetectedForm]:
        """Convenience method: detect all forms, fill them, submit, return results."""
        forms = await self.detect_forms()
        results = []
        for form in forms:
            if not form.fields:
                continue
            filled = await self.fill_form(form)
            submitted = await self.submit_form(filled)
            results.append(submitted)
        return results
