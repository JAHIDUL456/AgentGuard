<?php

namespace AgentGuard\Sample;

use DateTime;
use Exception;

class LoggerService {
    public function logMessage(string $msg): void {
        echo $msg;
    }
}

function initLogger(): LoggerService {
    return new LoggerService();
}

