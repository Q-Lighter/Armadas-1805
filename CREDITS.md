# Credits

## Map data

**Natural Earth**, 1:10m land. Natural Earth data is in the **public domain**
(<https://www.naturalearthdata.com/about/terms-of-use/>). No attribution is
required, but the source is credited here anyway.

The data is fetched as the npm package **world-atlas** 2.0.2, file
`land-10m.json` (<https://github.com/topojson/world-atlas>). world-atlas is
released under the ISC licence:

> Copyright 2013-2019 Michael Bostock
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

The TopoJSON is decoded with **topojson-client**, also ISC licensed and
copyright 2012-2016 Michael Bostock. The simplification, clipping, tiling and
land-mask code in `scripts/build-map.ts` is this project's own work.

No map feature is drawn by hand. Later invented features, if any, are declared
in `shared/data/inventedFeatures.ts` and merged by the same build script.

## Fonts

IM Fell English and Source Sans 3 are licensed under the SIL Open Font License
1.1. The licence files are committed next to the fonts in `client/fonts/`.
