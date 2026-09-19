from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

OUT = "/Users/mac/Library/CloudStorage/OneDrive-Personal/codes/projects/future-light-store/docs/vs-store-dsers-product-search-terms.docx"


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color="D9D9D9", size="6"):
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def keep_row_together(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    cant_split.set(qn("w:val"), "true")
    tr_pr.append(cant_split)


def set_col_widths(table, widths):
    for row in table.rows:
        for idx, width in enumerate(widths):
            row.cells[idx].width = Inches(width)


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    hdr = table.rows[0]
    set_repeat_table_header(hdr)
    keep_row_together(hdr)
    for idx, text in enumerate(headers):
        cell = hdr.cells[idx]
        cell.text = text
        shade(cell, "243447")
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell)
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            for run in p.runs:
                run.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)
                run.font.size = Pt(9)
    for row_idx, values in enumerate(rows):
        new_row = table.add_row()
        keep_row_together(new_row)
        cells = new_row.cells
        for idx, value in enumerate(values):
            cell = cells[idx]
            cell.text = str(value)
            shade(cell, "F7F9FB" if row_idx % 2 else "FFFFFF")
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            for p in cell.paragraphs:
                p.paragraph_format.space_after = Pt(0)
                for run in p.runs:
                    run.font.size = Pt(8.5)
    if widths:
        set_col_widths(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        p.add_run(item)


doc = Document()
sec = doc.sections[0]
sec.page_width = Inches(8.5)
sec.page_height = Inches(11)
sec.top_margin = Inches(0.65)
sec.bottom_margin = Inches(0.65)
sec.left_margin = Inches(0.7)
sec.right_margin = Inches(0.7)

styles = doc.styles
styles["Normal"].font.name = "Aptos"
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Aptos")
styles["Normal"].font.size = Pt(10.5)
styles["Normal"].font.color.rgb = RGBColor(32, 38, 45)
styles["Normal"].paragraph_format.space_after = Pt(6)
for style_name, size in (("Title", 24), ("Heading 1", 16), ("Heading 2", 12.5), ("Heading 3", 11)):
    style = styles[style_name]
    style.font.name = "Aptos Display" if style_name in ("Title", "Heading 1") else "Aptos"
    style._element.rPr.rFonts.set(qn("w:eastAsia"), style.font.name)
    style.font.size = Pt(size)
    style.font.bold = True
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.paragraph_format.space_before = Pt(11 if style_name != "Title" else 0)
    style.paragraph_format.space_after = Pt(5)

title = doc.add_paragraph(style="Title")
title.add_run("VS Store DSers Product Search Terms")
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
subtitle = doc.add_paragraph()
subtitle.paragraph_format.space_after = Pt(10)
run = subtitle.add_run("US family store expansion plan for 567 additional products")
run.bold = True
run.font.size = Pt(12)
run.font.color.rgb = RGBColor(63, 78, 94)

intro = doc.add_paragraph()
intro.add_run("Purpose. ").bold = True
intro.add_run(
    "This document defines the DSers search terms, collection allocation, and product-quality rules for expanding VS Store from 2,433 active Shopify products toward the 3,000-product operating limit. "
    "The plan uses family-store categories already represented in Shopify and leaves out products that create avoidable safety, compliance, or customer-expectation risk."
)

doc.add_heading("Current scope and hard filters", level=1)
add_bullets(doc, [
    "Include products that fit a general US family store: children and toddlers, baby care and baby wear, kids toys, men's and women's fashion, accessories and complete fashion jewellery, beauty and hair care, anime and manga collectibles, books, action figures, pets, home, bedding, handloom, gaming, watches, and everyday electronic accessories.",
    "Keep only products with stock of at least 200 units at the supplier level. Re-check stock immediately before pushing to Shopify.",
    "Exclude any product already present in Shopify or already pushed through the connected DSers store. Match by supplier product ID, SKU, normalized title, and image fingerprint.",
    "Exclude batteries, power banks, portable chargers, logic boards, bare PCBs, embedded battery products, adult or erotic products, medical claims, ingestible supplements, and products with unclear safety or compliance information.",
    "Exclude replacement-only parts, repair kits, spare components, refurbished or damaged goods, and listings whose title or variants imply repair or replacement rather than a complete customer-ready product.",
    "Do not use products whose images or variants show a different item, supplier watermark, counterfeit branding, unsupported health promise, or an option name that a shopper cannot understand.",
])

doc.add_heading("Capacity allocation", level=1)
doc.add_paragraph(
    "The allocation below uses all 567 currently available product slots. The numbers are import slots, not the number of collection memberships. A suitable product may belong to more than one governed Shopify collection, but it must be counted only once against the 3,000-product cap."
)
allocation = [
    ("Kids toddlers and learning", 58, "Kids, Kids Wear, Toys"),
    ("Baby care and baby wear", 38, "Baby Care, Kids, Daily Living"),
    ("Women's fashion", 46, "Women's Fashion, Women"),
    ("Women's accessories and jewelry", 25, "Women's Accessories, Jewelry"),
    ("Beauty makeup and hair care", 50, "Beauty Makeup, Hair Care"),
    ("Men's fashion", 34, "Men's Fashion, Men"),
    ("Men's accessories", 21, "Men's Accessories, Bags and Wallets"),
    ("Pet essentials", 46, "Pet Essentials, Dog Supplies, Cat Supplies"),
    ("Home decor bedding and handloom", 58, "Home and Decor, Bedsheets, Dining"),
    ("Electronic accessories audio and cases", 54, "Electronic Accessories, Audio, iPhone Cases"),
    ("Gaming accessories", 25, "Gaming, Controllers and Cases"),
    ("Watches and watch accessories", 21, "Watches, Watch Bands and Cases"),
    ("Anime manga books and action figures", 45, "Anime Collectables, Books, Figures"),
    ("Outdoor travel cleaning and useful gifts", 46, "Travel, Cleaning Tools, Gifts"),
    ("Total", 567, "Capacity limit")
]
add_table(doc, ["Collection gap", "Slots", "Primary Shopify collections"], allocation, [2.35, 0.65, 3.8])

doc.add_heading("Priority search terms for DSers", level=1)
doc.add_paragraph(
    "Use one phrase at a time in DSers Product Research. Keep the phrase specific enough to surface a product with a clear buyer use case. Add the listed modifiers only when the base search returns too many generic or low-quality results."
)
terms = [
    ("Kids and toddlers", "Montessori busy board toddler", "wooden, non-electronic, age label, smooth edges", "no small-part or safety claim without evidence"),
    ("Kids and toddlers", "sensory stepping stones kids", "non-slip, indoor play, 3 to 8 years", "no battery, no unsafe load claims"),
    ("Kids toys", "STEM building blocks educational set", "compatible pieces, storage box, age range", "no trademark misuse"),
    ("Kids toys", "washable kids art supplies set", "non-toxic claim only if documented, washable, storage", "no unverified safety certification"),
    ("Baby care", "silicone baby bib food catcher", "soft silicone, adjustable neck, dishwasher-safe only if stated", "no medical or feeding guarantee"),
    ("Baby care", "stroller organizer bag", "zip pockets, bottle holders, universal fit only when verified", "no unsafe car-seat claims"),
    ("Baby wear", "organic cotton baby romper", "fabric composition, snap closure, size chart", "avoid unsupported organic claims"),
    ("Women's fashion", "linen blend oversized shirt women", "fabric, fit, sleeve length, size range", "no model-only sizing"),
    ("Women's fashion", "modest knit midi dress women", "fabric, length, season, fit", "avoid body-shape or medical claims"),
    ("Women's accessories", "structured crossbody bag women", "dimensions, compartments, strap length", "no counterfeit brand terms"),
    ("Jewelry", "stainless steel minimalist necklace women", "metal/material, chain length, pendant dimensions", "reject unsupported precious-metal or hypoallergenic claims"),
    ("Jewelry", "hypoallergenic stud earrings set", "material, post and backing type, pair count", "reject unsupported allergy or precious-metal claims"),
    ("Jewelry", "layered pendant necklace set", "necklace count, chain length, pendant material", "no counterfeit branding or loose replacement parts"),
    ("Jewelry", "stackable fashion rings set", "ring count, size range, material, finish", "no unsupported gemstone or precious-metal claims"),
    ("Beauty", "reusable makeup organizer acrylic", "dimensions, compartments, countertop use", "no skincare performance claim"),
    ("Beauty", "heatless curling ribbon set", "satin or stated material, overnight use, included pieces", "no heat-protection claim"),
    ("Hair care", "scalp massage shampoo brush", "soft silicone, handle, wet-use care", "no hair-growth or medical claim"),
    ("Men's fashion", "men's textured knit polo", "fabric, collar, fit, size range", "no luxury brand imitation"),
    ("Men's accessories", "RFID card holder slim wallet", "materials, card capacity, dimensions", "RFID claim must be documented"),
    ("Pet essentials", "slow feeder dog bowl", "diameter, material, non-slip base", "no veterinary or digestion guarantee"),
    ("Pet essentials", "cat tunnel collapsible", "diameter, length, material, foldability", "avoid misleading pet-size claims"),
    ("Pet grooming", "reusable pet deshedding brush", "bristle type, handle, coat compatibility", "no claim of removing every hair"),
    ("Home decor", "washable neutral area rug", "dimensions, pile, backing, care", "do not use fire-rating claims without proof"),
    ("Home storage", "stackable closet storage bins", "dimensions, handles, material, load guidance", "no load claim without supplier evidence"),
    ("Bedding", "cotton duvet cover set neutral", "fabric composition, size, closure, included pieces", "avoid thread-count inflation"),
    ("Electronic accessories", "USB C cable braided data", "length, connector type, data and charging limits", "exclude chargers and power banks"),
    ("Electronic accessories", "wireless earbud protective case", "exact model compatibility, material, hinge or clip", "no earbuds or battery included"),
    ("Electronic accessories", "mechanical keyboard wrist rest", "dimensions, compatible layouts, surface material", "no logic board or electronic component"),
    ("Phone accessories", "iPhone magnetic phone stand", "compatible models, fold angle, material", "no battery or wireless charger"),
    ("Gaming", "console controller thumb grips", "console compatibility, quantity, material", "no branded counterfeit wording"),
    ("Gaming", "console travel carrying case", "exact console model, padding, pockets", "no console or battery included"),
    ("Watches", "automatic mechanical watch men", "movement type, case size, water resistance only if stated", "exclude battery watches for this intake"),
    ("Watch accessories", "watch storage box organizer", "capacity, cushion size, closure, material", "no luxury brand references"),
    ("Anime and manga", "anime figure display stand collectible", "height, material, included stand, character licensing evidence", "reject copied logos or unclear IP"),
    ("Anime and manga", "manga panel wall art print", "paper or canvas size, print method, licensed or original art", "reject counterfeit character art"),
    ("Books and reading", "wooden book stand adjustable", "angle range, dimensions, foldability, material", "no electronic reading light"),
    ("Action figures", "articulated action figure display", "height, joints, accessories, age guidance", "reject weapons marketed to children without clear context"),
    ("Travel", "packing cubes compression set", "sizes, zippers, fabric, quantity", "no vacuum pump or battery"),
    ("Cleaning", "microfiber window cleaning kit", "handle length, cloth count, surfaces", "no chemical promises"),
    ("Gifts", "personalized family name home sign", "dimensions, material, personalization workflow", "supplier must support exact personalization"),
]
add_table(doc, ["Collection", "DSers search phrase", "Evidence to verify", "Reject when"], terms, [1.15, 2.05, 2.3, 1.3])

doc.add_heading("Product page and AI search requirements", level=1)
add_bullets(doc, [
    "Title format: product type first, then the strongest verified attribute, then the intended use or audience. Example: Adjustable Wooden Book Stand for Desk Reading and Display.",
    "Description format: explain what the item is, who it is for, how it is used, the verified materials or dimensions, what is included, compatibility, and care. Never paste supplier field labels or duplicate raw specifications.",
    "SEO: use one primary product phrase, supporting synonyms, a unique meta title, a readable meta description, clean image alt text, and a canonical product URL. Avoid keyword stuffing.",
    "AEO and GEO: answer real shopper questions directly in the product page. Include concise sections for compatibility, size, included items, care, delivery expectations, and who the product suits. Keep every answer tied to verified catalog facts.",
    "Structured data: keep Product, Offer, availability, price, variant, and shipping data synchronized with Shopify. An AI system should see the same product name, price, stock, and options that a shopper sees.",
    "Trust: use clean product images, readable variant names, honest delivery language, and no claims about health, safety, performance, or certification that the supplier cannot document.",
])

doc.add_heading("DSers operating sequence", level=1)
sequence = [
    ("1", "Search", "Use one approved phrase and the US shipping filter where available."),
    ("2", "Shortlist", "Keep items with stock at least 200, clear variants, clean images, usable dimensions, and a consistent supplier listing."),
    ("3", "Deduplicate", "Compare DSers supplier ID, SKU, normalized title, and image fingerprint against Shopify and the DSers My Products list."),
    ("4", "Import", "Add only the approved product to the DSers import list. Keep the category and evidence notes with the item."),
    ("5", "Review", "Check product identity, variant mapping, price, shipping, and collection fit before the Shopify push."),
    ("6", "Push", "Push in controlled batches. After each batch, verify Shopify product count, inventory, images, variants, and Online Store publication."),
    ("7", "Release", "Start the guarded release only after the Shopify readback confirms the imported products and collection assignments."),
]
add_table(doc, ["Step", "Action", "Required check"], sequence, [0.55, 1.05, 5.2])

doc.add_heading("Trend and search evidence", level=1)
doc.add_paragraph(
    "The search phrases use current 2026 directional signals rather than guaranteed demand forecasts. Shopify's 2026 dropshipping guide identifies tools and home improvement, apparel, beauty, baby products, and pet supplies as active categories; its trending-products guide also highlights vehicle electronics, beauty, home-spa products, and apparel. Shopify's GEO guidance emphasizes complete, structured product information for AI discovery. These signals support the category mix, but every DSers candidate still needs the inventory, identity, margin, and compliance checks above."
)
sources = [
    "Shopify Dropshipping Products 2026: https://www.shopify.com/blog/best-dropshipping-products",
    "Shopify Trending Products 2026: https://www.shopify.com/blog/trending-products",
    "Shopify GEO Playbook: https://www.shopify.com/enterprise/blog/generative-engine-optimization",
    "Shopify Consumer Electronics Trends: https://www.shopify.com/enterprise/blog/consumer-electronics-trends",
]
for source in sources:
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(source)

doc.add_heading("Release acceptance checklist", level=1)
add_bullets(doc, [
    "Import total never exceeds the 567 available slots unless the Shopify product limit is independently confirmed to have changed.",
    "Every pushed product has stock at least 200, a verified supplier identity, at least one usable image, and a readable variant mapping.",
    "No batteries, portable chargers, logic boards, adult products, counterfeit branding, or unsupported medical claims are present.",
    "Every product is assigned only to collections supported by its evidence. No product is left collectionless.",
    "Shopify live readback confirms title, description, price, inventory, variants, images, tags, Online Store publication, and collection membership.",
    "The guarded release is started only after the readback passes. A failed network or permission gate remains paused for safe resume.",
])

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer_run = footer.add_run("VS Store  |  DSers product intake plan  |  Prepared 19 September 2026")
footer_run.font.size = Pt(8)
footer_run.font.color.rgb = RGBColor(96, 105, 116)

doc.save(OUT)
print(OUT)
