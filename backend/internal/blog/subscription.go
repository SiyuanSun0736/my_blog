package blog

import "time"

type Subscription struct {
	Email     string    `json:"email" bson:"email"`
	CreatedAt time.Time `json:"createdAt" bson:"createdAt"`
}

type subscriptionRequest struct {
	Email string `json:"email"`
}

type subscriptionResponse struct {
	Email   string `json:"email"`
	Created bool   `json:"created"`
	Message string `json:"message"`
}
