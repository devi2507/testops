"""
Pre-built test instruction templates for common UI testing scenarios.
Each template includes a name, description, icon hint, and list of
natural-language instructions for the browser-use Agent.
"""

INSTRUCTION_TEMPLATES = {
    "auth_flow": {
        "id": "auth_flow",
        "name": "Authentication Flow",
        "icon": "Lock",
        "description": "Test login, logout, and forgot-password flows with realistic credentials.",
        "instructions": [
            "Find the login form, fill it with username 'testuser@example.com' and password 'TestPass123!' and submit it",
            "Check if the page shows an error message or redirects after login submission",
            "Look for a logout or sign-out button and click it",
            "Find a 'forgot password' or 'reset password' link and click it",
            "If a password reset form appears, enter 'testuser@example.com' and submit",
        ],
    },
    "contact_forms": {
        "id": "contact_forms",
        "name": "Contact & Lead Forms",
        "icon": "Mail",
        "description": "Fill all contact/lead forms with realistic data and verify confirmation.",
        "instructions": [
            "Find a contact form or lead generation form on the page",
            "Fill all visible form fields with realistic test data (name, email, phone, message)",
            "Submit the contact form and check for a success or confirmation message",
            "Check if any required field validation errors appear when submitting an empty form",
            "Verify the form resets or shows a thank-you message after successful submission",
        ],
    },
    "ecommerce": {
        "id": "ecommerce",
        "name": "E-commerce Flow",
        "icon": "ShoppingCart",
        "description": "Test add-to-cart, cart management, and checkout initiation.",
        "instructions": [
            "Find a product listing or catalog page and click on the first product",
            "Click the 'Add to Cart' or 'Buy Now' button on the product page",
            "Navigate to the shopping cart and verify the item appears",
            "Look for a quantity selector and change the quantity",
            "Click the checkout or proceed button and verify the checkout form appears",
        ],
    },
    "search_filter": {
        "id": "search_filter",
        "name": "Search & Filter",
        "icon": "Search",
        "description": "Test search functionality, filters, and result pagination.",
        "instructions": [
            "Find the search bar or search input field on the page",
            "Type 'test' into the search field and press Enter or click the search button",
            "Verify that search results appear on the page",
            "If filter options exist, apply the first available filter",
            "Check if pagination exists and click the next page button",
        ],
    },
    "navigation": {
        "id": "navigation",
        "name": "Navigation Flow",
        "icon": "Compass",
        "description": "Visit all navigation links and verify page loads without errors.",
        "instructions": [
            "Find the main navigation menu and list all available links",
            "Click the first navigation link and verify the page loads without errors",
            "Click the second navigation link and verify it loads properly",
            "Click the logo or home link to return to the homepage",
            "Check if any navigation links lead to 404 error pages",
        ],
    },
    "accessibility": {
        "id": "accessibility",
        "name": "Accessibility Quick Check",
        "icon": "Eye",
        "description": "Test keyboard navigation, focus states, and basic accessibility.",
        "instructions": [
            "Press Tab key multiple times and verify focus moves to interactive elements in logical order",
            "Check if focused elements have visible focus indicators (outlines or highlights)",
            "Find all images on the page and check if they have alt text attributes",
            "Check if all form inputs have associated labels",
            "Try navigating the page using only the keyboard (Tab, Enter, Escape keys)",
        ],
    },
}


def get_template(template_id: str) -> dict | None:
    """Get a single template by ID."""
    return INSTRUCTION_TEMPLATES.get(template_id)


def get_all_templates() -> list[dict]:
    """Return all templates as a list."""
    return list(INSTRUCTION_TEMPLATES.values())
