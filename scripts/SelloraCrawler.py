import os
import re
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify
from tqdm import tqdm

BASE_URL = "https://docs.stripe.com/"
OUTPUT_DIR = "../documents/stripe_docs"

REQUEST_DELAY = 1.0
MAX_PAGES = 1000

session = requests.Session()
session.headers.update({
    "User-Agent": "SelloraDocsCrawler/1.0 (+https://example.com)"
})


visited = set()
queue = [BASE_URL]


def is_valid(url):
    parsed = urlparse(url)

    if parsed.netloc != urlparse(BASE_URL).netloc:
        return False

    if "#" in url:
        return False

    if any(url.endswith(ext) for ext in [
        ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".css", ".js", ".ico", ".woff", ".woff2",
        ".zip", ".pdf"
    ]):
        return False

    return True


def filename_from_url(url):
    path = urlparse(url).path.strip("/")

    if not path:
        path = "index"

    path = re.sub(r"[^a-zA-Z0-9/_-]", "", path)
    path = path.replace("/", "__")

    return path + ".md"


os.makedirs(OUTPUT_DIR, exist_ok=True)

count = 0

with tqdm(total=MAX_PAGES) as pbar:
    while queue and count < MAX_PAGES:
        url = queue.pop(0)

        if url in visited:
            continue

        visited.add(url)

        try:
            r = session.get(url, timeout=30)

            if r.status_code != 200:
                continue

            soup = BeautifulSoup(r.text, "lxml")

            # remove navigation, footer etc.
            for tag in soup([
                "script",
                "style",
                "nav",
                "footer",
                "header",
                "noscript",
                "aside"
            ]):
                tag.decompose()

            # Stripe docs use <main> for content
            main = soup.find("main")

            if main is None:
                main = soup.body

            if main is None:
                continue

            md = markdownify(str(main), heading_style="ATX")

            outfile = os.path.join(
                OUTPUT_DIR,
                filename_from_url(url)
            )

            with open(outfile, "w", encoding="utf8") as f:
                f.write(f"# Source\n\n{url}\n\n")
                f.write(md)

            count += 1
            pbar.update(1)

            for a in soup.find_all("a", href=True):
                href = urljoin(url, a["href"])

                href = href.split("#")[0]

                if is_valid(href) and href not in visited:
                    queue.append(href)

            time.sleep(REQUEST_DELAY)

        except Exception as e:
            print(f"Failed {url}: {e}")

print(f"\nDone.")
print(f"Pages downloaded: {count}")
print(f"Saved to: {OUTPUT_DIR}")