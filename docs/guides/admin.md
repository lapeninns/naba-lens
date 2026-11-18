# Naba-Lens for admins

A short guide to setting up and running Naba-Lens across every venue. The words in **bold** are the words on your screen. For the full reference, see the older [admin guide](../usage-admin.md). Managers' and staff's sides are in the [manager guide](manager.md) and the [staff guide](staff.md).

## Sign in

Admin accounts need **Two-step sign-in**. The first time, choose **Set up with an authenticator app**, scan the code and **Confirm code**. Each sign-in after that asks you to **Enter your sign-in code** from the app. If you lose your phone, another admin can **Reset authenticator** on your page under People.

## Where things are

On a computer the top bar shows **Overview**, **Venues**, **Menus**, **Library**, **Publishing**, **People** and **Settings**. On a phone or tablet the tab bar shows Overview, Venues, Library and **More**; More lists every section by its full name (**Menus & catalog**, **Settings & activity**).

## Four different things

| Stage     | Where you see it                        | What it means                                                                                                        |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sent      | Library, Overview's **Oldest waiting**  | A photo is stored and waiting for its venue's reviewer.                                                              |
| Decided   | The photo's **Review history**          | Approved for public use, kept as reference, another photo asked for, or not used.                                    |
| Covered   | Overview, Metrics: "_n_ of _N_"         | A slot is covered only by a current photo accepted for public use. Reference photos and duplicates never count.      |
| Published | Publishing: **Exported**, **Published** | Exported means a package was downloaded. Published means you recorded where it went up, the date and who checked it. |

## Set up a venue

1. **Venues › Add a venue**: **Name**, **Town or village**, **Timezone** (every Lapen Inns pub today uses Europe/London) and **Address**. Choose **Add the venue**.
2. The venue page opens with its **Setup checklist**: **Current menu confirmed**, **Main and backup reviewer**, **Staff invited**, **Spaces and facilities checked**, **First accepted photo**. Venues with setup still to do come first on the Venues list.
3. **What this venue collects**: under **Copy from**, choose **The group catalogue (core questions)**, then **Preview what would be added** and **Add as requirements to check**. Turn **Accommodation** on or off here, with a reason.
4. **Status**: **Operating status** is **Open**, **Temporarily closed** or **Closed for good**, with a reason. Closed for good archives the venue, and the screen shows what archiving does first.

Changes to a venue's details ask **Why are you changing this?**, and the old and new values are kept in **Activity**.

## Name reviewers

On the venue page, under **Reviewers**, choose a **Main reviewer** (reviews this venue's photos first) and a **Backup reviewer** (reviews when the main reviewer is away). They must be two different people.

Only people who review at that venue can be chosen: its managers and the group admins. To add someone, make them the venue's manager under People first. Otherwise the screen says "That person doesn't review at this venue. Make them its manager first."

## Invite and manage people

- **People › Invite staff**: **Name**, **Email**, **Venue** and **Team**, then **Send invitation**. They get a single-use sign-in link.
- **A person's page** shows **Venues and what they can do**. Roles are per venue: use **Add a venue or change the role**, choose **Staff** or **Manager** under **Role at this venue**, then **Save venue role**. Someone can be staff at one venue and a manager at another.
- **Deactivate** removes access straight away. Their photos stay in the Library, and you can reactivate the account later.
- **Make admin** and **Remove admin role**: there is always at least one active admin.

## Menus

A venue's menu is used only to label photos. **Active · for labelling only** means just that: it isn't a public menu and doesn't change any website.

1. **Menus**, then the venue. **Import a menu** (use **Download the CSV template** for the columns), or **Start a draft from the active menu**.
2. The preview separates **Changed presentation** (those dishes' photos go back for a recheck) from other changes, and lists **Proposed retirements**. Importing the same file again opens the existing draft.
3. **Activate for labelling** now, or **Schedule activation** for a date. Activation stays blocked until you tick each proposed retirement.
4. **Change requests** from managers: **Accept**, **Ask for clarification** or **Decline**.

Prices, dietary and spice values in a file are kept as source details only. Staff never see them.

## Settings

**Settings** shows what needs attention, **Operations** (storage, stuck processing, failed uploads) and the **Rules for every venue**:

- **Quiet hours**: no notices between **Quiet from** and **Quiet until** (21:00 to 08:00 by default).
- **Reminders and alerts**: how often managers are reminded about waiting photos, and when admins are told a photo has waited too long.
- **Retention**: when unfinished uploads are removed.
- **Allowed export profiles**: Original, Website, Social, Custom.
- **Storage**: the quota and the warning level.

Every change asks **Why are you changing this?** and is kept in **Activity** ("Who changed what, where and why").

## The Library

The Library holds every ready photo and video across the group. Filter by **Venue**, **Staff member** and **Media**, or open **More filters** for review state, tags, collections, requests and where a photo is published.

A photo's page shows **Where it's used**, **Original and provenance**, **Labels**, **Review history**, **Exports and publication** and **Possible duplicates**. From there you can **Download original**, **Withdraw from use** (or **Restore**), **Correct venue**, **Manage tags** or add it to a collection.

### Keep a photo as reference

Reference is a review decision made by the venue's reviewer (**Keep as reference**, see the [manager guide](manager.md#review-photos)). A reference photo stays stored and visible to the team, never closes a public-photo slot and never goes in a public export.

### Remove a photo for good

Staff can't delete a photo once it has been checked; they ask, and their requests appear under **Removal requests**. Choose **Keep the photo** or **Review removal**. **Permanently remove…** shows **What this removes** and asks **Why it must be removed**. The stored files are deleted, but the record, who took it, the reason and its history are kept. A published photo must be withdrawn from its public uses first.

## Export and publish

1. **Publishing › Make an export package**. Choose the **Venue** and the **Kind of export**:
   - **Approved for public use**: only photos approved for public use now can be chosen.
   - **Internal**: every photo at the venue, including reference and not-yet-reviewed ones. Each file is marked internal only. Never publish an internal package.
2. **Choose photos**, check **Alt text**, pick an **Output size**, say **What it's for**, then **Make package · _n_ photos** and **Download ZIP**. The package reads **Exported**.
3. When a photo goes on a website or listing, open the package and choose **Record where it's published**: **Where**, **Page address**, **Date it went up**, then **Record as Published**.
4. When a published photo is withdrawn, it shows under **Needs following up**. After it is taken down, use **Confirm it's taken down**.

Exported is not Published, and only you record Published.

## Overview and Metrics

**Overview** shows every venue's coverage and backlog: **Facts confirmed**, **Unlabelled**, **Oldest waiting**, **Checks due**, **Publication errors** and what was added in the period. **Venues needing attention** comes first. Each number opens the records behind it. Filter by **Venue**, **Menu**, **Reporting period** and **Categories** (Food, Drinks, Spaces, Facilities, Other).

**Metrics** explains how each number is counted for a chosen venue.
