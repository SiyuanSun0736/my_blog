package blog

type BodyFormat string

const (
	BodyFormatMarkdown BodyFormat = "markdown"
	BodyFormatHTML     BodyFormat = "html"
)

type Post struct {
	ID          int        `json:"id" bson:"id"`
	Slug        string     `json:"slug" bson:"slug"`
	Title       string     `json:"title" bson:"title"`
	Summary     string     `json:"summary" bson:"summary"`
	Category    string     `json:"category" bson:"category"`
	Tags        []string   `json:"tags" bson:"tags"`
	Author      string     `json:"author" bson:"author"`
	PublishedAt string     `json:"publishedAt" bson:"publishedAt"`
	ReadMinutes int        `json:"readMinutes" bson:"readMinutes"`
	Draft       bool       `json:"draft" bson:"draft"`
	Featured    bool       `json:"featured" bson:"featured"`
	Accent      string     `json:"accent" bson:"accent"`
	BodyFormat  BodyFormat `json:"bodyFormat" bson:"bodyFormat,omitempty"`
	Body        string     `json:"body,omitempty" bson:"body,omitempty"`
}

type CreatePostInput struct {
	Slug        string     `json:"slug"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Category    string     `json:"category"`
	Tags        []string   `json:"tags"`
	Author      string     `json:"author"`
	PublishedAt string     `json:"publishedAt"`
	Draft       bool       `json:"draft"`
	Featured    bool       `json:"featured"`
	Accent      string     `json:"accent"`
	BodyFormat  BodyFormat `json:"bodyFormat"`
	Body        string     `json:"body"`
}

type HTMLImportResult struct {
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Summary     string     `json:"summary"`
	Tags        []string   `json:"tags"`
	Author      string     `json:"author"`
	PublishedAt string     `json:"publishedAt"`
	BodyFormat  BodyFormat `json:"bodyFormat"`
	Body        string     `json:"body"`
}

type PDFExportInput struct {
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Category    string     `json:"category"`
	Tags        []string   `json:"tags"`
	Author      string     `json:"author"`
	PublishedAt string     `json:"publishedAt"`
	Accent      string     `json:"accent"`
	BodyFormat  BodyFormat `json:"bodyFormat"`
	Body        string     `json:"body"`
}

type SetPostFeaturedInput struct {
	Featured *bool `json:"featured"`
}

type BatchPostsInput struct {
	Action string   `json:"action"`
	Slugs  []string `json:"slugs"`
}
