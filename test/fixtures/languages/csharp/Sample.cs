using System;
using System.Collections.Generic;

namespace AgentGuard.Sample
{
    public class SampleService
    {
        public bool Validate(string input)
        {
            return !string.IsNullOrEmpty(input);
        }
    }
}

