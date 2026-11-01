package main

import (
	"fmt"
	"net/http"
)

type ServerConfig struct {
	Port int
	Host string
}

type Router interface {
	Handle(pattern string, handler http.Handler)
}

func StartServer(cfg ServerConfig) error {
	fmt.Println("Starting server on", cfg.Port)
	return nil
}

