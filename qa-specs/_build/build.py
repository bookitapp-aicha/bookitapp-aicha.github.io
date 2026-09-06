import io, re

src   = io.open('../../bookit-qa-handbook.html', encoding='utf-8').read()
fonts = io.open('fonts-inlined.css', encoding='utf-8').read()

# 1. Strip the artifact-only head bits (title tag + Google Fonts links)
src = re.sub(r"<title>.*?</title>\s*", "", src, count=1, flags=re.S)
src = re.sub(r"<link rel=\"preconnect\"[^>]*>\s*", "", src)
src = re.sub(r"<link rel=\"stylesheet\" href=\"https://fonts\.googleapis\.com[^\"]*\">\s*", "", src)

# 2. Pull the page's own <style> block out so it can live in <head>
m = re.search(r"<style>(.*?)</style>\s*", src, re.S)
page_css = m.group(1)
body = src[:m.start()] + src[m.end():]

RESET = """
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}
img,svg,video{max-width:100%;height:auto}
[hidden]{display:none!important}
""".strip()

FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
           "%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%AA%3C/text%3E%3C/svg%3E")

DESC = ("Platform introduction and onboarding handbook for new QA testers on Bookit - "
        "architecture, domain concepts, risk areas, and a smoke-test checklist.")

html = u"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="%s">
<title>Bookit QA Handbook</title>
<link rel="icon" href="%s">
<style>:root{color-scheme:light dark}
%s
/* ---- fonts: inlined woff2 (latin + latin-ext), no external requests ---- */
%s
</style>
<style>
%s</style>
</head>
<body>
%s
</body>
</html>
""" % (DESC, FAVICON, RESET, fonts, page_css, body.strip())

io.open('../index.html', 'w', encoding='utf-8').write(html)
print("wrote QA-specs/index.html  %.0f KB" % (len(html.encode('utf-8'))/1024.0))
