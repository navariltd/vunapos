---
name: frappe-doctype-design
description: Design, create, review, or restructure Frappe and ERPNext DocTypes with meaningful form hierarchy, user-flow-driven field ordering, restrained descriptions, and Frappe-native JSON conventions.
---

# Frappe DocType Design Conventions

When creating or modifying Frappe DocTypes, treat the DocType as both a data model and a user-facing workflow.

## General principle

Do not merely append fields in implementation order.

Design the form around:

1. what the user needs to understand first,
2. what the user needs to enter,
3. what the system derives,
4. what becomes relevant later in the document lifecycle,
5. what information is secondary or administrative.

The order of fields should follow the user's mental and operational flow, not the order in which requirements were provided.

Before editing a DocType, inspect relevant existing DocTypes in this repository and standard ERPNext/Frappe DocTypes for established conventions.

## Form hierarchy

Use layout controls intentionally:

- `Tab Break` only when the form contains genuinely distinct information groups or lifecycle concerns.
- `Section Break` when a group of fields belongs to one clear task or concept.
- `Column Break` when related fields benefit from side-by-side scanning.
- Do not create layout breaks merely to make the JSON appear structured.
- Do not create a section containing only one ordinary field unless that field is conceptually significant.
- Prefer fewer meaningful sections over many tiny sections.
- Prefer a single well-structured Details tab for simple DocTypes.

If tabs are used, the first tab should usually contain the primary workflow.

Typical secondary tabs may include concepts such as:
- Configuration
- Accounting
- Logistics
- References
- Audit / Additional Information

Only use these when the DocType actually needs them.

## Field ordering

Prioritize fields approximately in this order when applicable:

1. identity / primary reference
2. context / parent entity / company / branch
3. status and important workflow state
4. primary user input
5. operational details
6. child tables
7. derived / calculated values
8. references and supporting information
9. administrative or rarely edited information

Do not bury the primary action-driving fields below configuration or metadata.

Fields that are read together should generally appear together.

## User and data flow

Before creating the field list, briefly determine:

- Who creates this document?
- Why are they creating it?
- What information do they know at creation time?
- What information becomes available later?
- What fields determine downstream behavior?
- What information is calculated by the system?
- What information is only useful for review?
- Which fields are exceptional rather than part of the normal path?

Use these answers to determine form layout.

Do not ask the user to enter information earlier than they naturally know it.

## Descriptions

Use `description` sparingly.

Do not add descriptions that merely restate the label.

Bad:
- Label: Customer
- Description: Select the customer.

Bad:
- Label: Status
- Description: The status of the document.

Use descriptions only when they explain:
- a non-obvious business rule,
- an important consequence,
- an unusual format,
- a source of data,
- a restriction,
- behavior that would otherwise surprise the user.

Descriptions should normally be one concise sentence.

If the field is self-explanatory, omit the description.

## Labels

Prefer concise business language.

Do not use implementation terminology in user-facing labels unless the users already understand it.

Avoid unnecessarily verbose labels.

Prefer:
- Delivery Date
- Vehicle
- Customer Group

Over:
- Expected Delivery Completion Date
- Selected Vehicle Reference
- Customer Classification Group

## Field types

Use the most semantically correct Frappe field type.

Do not use `Data` when a more specific field type exists.

Examples:
- `Link` for references
- `Date` for calendar dates
- `Datetime` for a specific point in time
- `Time` for time-of-day
- `Duration` for elapsed time
- `Currency` for monetary values
- `Percent` for percentages
- `Check` for boolean values
- `Select` for small controlled state sets
- `Table` for repeated structured child rows

## Datetime values and DocType JSON metadata

When generating standard DocType JSON files, follow the structure produced by Frappe developer mode as closely as practical.

- Every standard DocType definition JSON, including child DocTypes, must contain root-level `creation` and `modified` timestamps. These describe the DocType definition, not its business records; do not add duplicate fields to `fields` or `field_order`.
- Serialize both as absolute Frappe datetime strings: `YYYY-MM-DD HH:MM:SS.ffffff` (for example, `2026-11-07 21:12:19.055541`). Use the development site's timezone, not a relative date, Unix timestamp, ISO `T`/`Z` string, placeholder, or runtime expression such as `now()` or `now_datetime()`.
- For a new DocType, obtain the actual current datetime using Frappe or the real clock in the development site's timezone and write that literal value. Never invent a historical creation date.
- Preserve an existing `creation` exactly when editing or exporting a DocType. Do not reset it to the current date during reviews, migrations, installation, or formatting.
- Set `modified` to the actual edit/export datetime when changing a definition. Do not refresh timestamps as a side effect of a read-only review or unrelated formatting.
- When repairing missing metadata, prefer the original developer-mode export or historical definition. If no original timestamp exists, use the first Git introduction of that same DocType as a documented approximation; do not mistake copy/rename detection for the creation of a different DocType. State the source and uncertainty rather than presenting a commit date as an exact creation timestamp.
- Include `owner` and `modified_by` according to the developer-mode export and repository convention. Preserve known values; Git author names are not automatically valid Frappe User IDs.
- Check all four audit metadata keys before finishing. Other exported properties may be optional/defaulted; do not blindly add or change behavioral settings merely to make JSON files look uniform.

## Existing conventions first

Before creating a DocType:

1. Inspect 2-3 comparable DocTypes in this app.
2. Inspect relevant ERPNext/Frappe patterns where appropriate.
3. Reuse established naming and layout conventions.
4. Do not introduce a new layout style unless the existing one is clearly unsuitable.

## Child tables

Keep child table rows compact.

Fields shown in the grid should prioritize information required to identify and compare rows.

Do not expose every child field in list/grid view.

Place advanced or supporting child fields later so the expanded row remains readable.

## Read-only and derived data

System-derived information should generally not compete visually with primary editable inputs.

Group read-only totals, calculated values, sync state, or integration metadata separately when they are useful to users.

Hide purely technical fields unless users genuinely need them.

## Implementation process

When asked to create or redesign a DocType:

1. Understand the business purpose.
2. Inspect related existing DocTypes.
3. Identify the normal user workflow.
4. Classify fields into primary, secondary, derived, reference, and exceptional information.
5. Propose the field/layout structure mentally before editing JSON.
6. Implement the JSON.
7. Review the resulting `field_order`.
8. Check whether the form would make sense to a first-time user.
9. Remove unnecessary descriptions and layout breaks.
10. Verify naming, field types, dependencies, defaults, mandatory flags, and list/filter visibility.

## Final sanity check

Before considering the DocType complete, verify:

- The first screen answers "what am I creating?"
- Related information is grouped together.
- The form reads naturally from top to bottom.
- Tabs represent real conceptual boundaries.
- Sections represent real tasks or concepts.
- The normal workflow is visually dominant.
- Rare settings do not interrupt the normal workflow.
- Descriptions are present only where useful.
- The field order matches user flow, not implementation order.
- Existing Frappe and repository conventions have been preserved.
- Root-level `creation`, `modified`, `owner`, and `modified_by` are present; datetime values are valid absolute Frappe strings, historical creation is preserved, and missing values were not silently replaced with today's date.
