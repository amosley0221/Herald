### Fixed
- Uploading a `.docx` resume failed with `400 invalid_request_error: The
  request body is not valid JSON: invalid high surrogate in string`. A `.docx`
  is a ZIP archive, and Herald was decoding anything that was not a PDF as
  UTF-8 text — which turns those bytes into lone surrogates that cannot be put
  in a JSON body at all, so the request was rejected before the model ever saw
  the resume. Herald now reads the text out of the archive, including headers
  and footers, where a resume often keeps its contact details. A file that
  still cannot be read as text says so instead of failing as a puzzle, and an
  old-format `.doc` is named as such rather than being attempted.
