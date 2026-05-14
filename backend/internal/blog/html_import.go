package blog

import (
	"fmt"
	"io"
	"mime/multipart"
)

var errHTMLImportTooLarge = fmt.Errorf("html import source exceeds %d bytes", maxHTMLImportBytes)

func importHTMLDocumentFromFile(fileHeader *multipart.FileHeader) (HTMLImportResult, error) {
	if fileHeader == nil {
		return HTMLImportResult{}, fmt.Errorf("html file is required")
	}

	if !isHTMLDocumentFileName(fileHeader.Filename) {
		return HTMLImportResult{}, fmt.Errorf("only .html or .htm files are supported")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return HTMLImportResult{}, fmt.Errorf("open html file: %w", err)
	}
	defer file.Close()

	contents, err := io.ReadAll(io.LimitReader(file, maxHTMLImportBytes+1))
	if err != nil {
		return HTMLImportResult{}, fmt.Errorf("read html file: %w", err)
	}

	if len(contents) > maxHTMLImportBytes {
		return HTMLImportResult{}, errHTMLImportTooLarge
	}

	imported, err := parseHTMLImportDocument(fileHeader.Filename, string(contents))
	if err != nil {
		return HTMLImportResult{}, err
	}

	return imported, nil
}
