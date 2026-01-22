#include <iconv.h>
#include <stddef.h>

// Forward declarations for GNU libiconv symbols.
extern size_t libiconv(iconv_t cd, char **inbuf, size_t *inbytesleft,
                       char **outbuf, size_t *outbytesleft);
extern iconv_t libiconv_open(const char *tocode, const char *fromcode);
extern int libiconv_close(iconv_t cd);
extern int libiconvctl(iconv_t cd, int request, void *argument);

size_t iconv(iconv_t cd, char **inbuf, size_t *inbytesleft, char **outbuf,
             size_t *outbytesleft) {
    return libiconv(cd, inbuf, inbytesleft, outbuf, outbytesleft);
}

iconv_t iconv_open(const char *tocode, const char *fromcode) {
    return libiconv_open(tocode, fromcode);
}

int iconv_close(iconv_t cd) {
    return libiconv_close(cd);
}

int iconvctl(iconv_t cd, int request, void *argument) {
    return libiconvctl(cd, request, argument);
}

